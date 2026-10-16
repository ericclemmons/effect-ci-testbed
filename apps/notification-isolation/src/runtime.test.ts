import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

test("private real Workflow/RPC journal continues after rejection or timeout; business failure stays original", { timeout: 40000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const bundle = await build({ stdin: { loader: "ts", resolveDir: new URL(".", import.meta.url).pathname, contents: `
    import handler,{ProviderIsolation,RejectingDestination,DeliveryJournal}from'./worker.ts';
    export{ProviderIsolation,RejectingDestination,DeliveryJournal};
    export default{async fetch(request,env,ctx){
      if(new URL(request.url).pathname==='/public')return handler.fetch();
      const p=await request.json();
      if(p.op==='start'){await ctx.exports.ProviderIsolation.create({id:p.id,params:p.params});return Response.json({started:true});}
      if(p.op==='status')return Response.json(await(await ctx.exports.ProviderIsolation.get(p.id)).status());
      const r=await ctx.exports.DeliveryJournal.getByName(p.id).read();
      try{return Response.json(r?{owner:r.owner,version:r.version,updates:r.updates,phase:r.snapshot.phase}:null);}
      finally{r?.[Symbol.dispose]?.();}
    }};` }, bundle: true, write: false, format: "esm", target: "esnext",
    conditions: ["workerd", "import"], external: ["cloudflare:workers", "cloudflare:workflows", "node:*"] });
  const config = { name: "provider-isolation-test", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
    exports: { ProviderIsolation: { type: "workflow", name: "provider-isolation-test" }, RejectingDestination: { type: "worker" },
      DeliveryJournal: { type: "durable-object", storage: "sqlite" } },
    env: { WORKER_METADATA: { type: "version-metadata" } } };
  const runtime = new Miniflare({ workers: [{ config }] });
  const call = async (p: unknown): Promise<any> => (await runtime.dispatchFetch("https://test.invalid/fixture", { method: "POST", body: JSON.stringify(p) })).json();
  try {
    for (const mode of ["success", "business-failure", "provider-timeout", "invalid"] as const) {
      const id = "local-" + mode;
      await call({ op: "start", id, params: mode === "invalid" ? { mode: "success", destination: "forbidden" } : { mode } });
      let status: any;
      for (let n = 0; n < 1200; n++) {
        status = await call({ op: "status", id });
        if (["complete", "errored"].includes(status.status)) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(status.status, ["business-failure", "invalid"].includes(mode) ? "errored" : "complete", JSON.stringify(status));
      const outputs = status.__LOCAL_DEV_STEP_OUTPUTS;
      if (mode === "invalid") { assert.equal(outputs.length, 0); assert.equal(await call({ op: "journal", id }), null); continue; }
      const rejected = outputs.filter((o: any) => o?.provider === "rejecting");
      if (mode === "provider-timeout") assert.ok(rejected.length <= 1,
        "A timed-out checkpoint can lack a return value; its separate failure receipt remains required");
      else assert.deepEqual(rejected, [{ provider: "rejecting", status: "failed" }]);
      const deliveryReceipts = outputs.filter((o: any) => Array.isArray(o?.deliveries));
      assert.ok(deliveryReceipts.length > 1, "Independent redacted delivery receipts are mandatory");
      assert.ok(deliveryReceipts.every((o: any) =>
        o.deliveries.find((d: any) => d.provider === "rejecting")?.status === "failed"));
      const invoked = outputs.find((o: any) => typeof o?.rejecting === "number");
      assert.equal(invoked.rejecting, 1, "Unknown delivery never runs again on a later event");
      const journal = await call({ op: "journal", id });
      assert.equal(journal.owner, id); assert.ok(journal.updates > 1);
      assert.match(journal.version, /^worker-version:.+/); assert.ok(!journal.version.endsWith(":undefined"));
      assert.equal(journal.phase, mode === "business-failure" ? "failure" : "success");
      assert.equal(invoked.journal, journal.updates);
      assert.equal(outputs.find((o: any) => o?.workflow === "notification-isolation")?.conclusion, journal.phase);
      assert.ok(outputs.some((o: any) => o?.owner === id && o?.snapshot?.phase === journal.phase));
      if (mode === "business-failure") assert.match(JSON.stringify(status.error), /Original owned business failure/);
      else { assert.equal(status.output.value, "business succeeded"); assert.equal(typeof status.output.workerVersion, "string"); }
      assert.ok(!JSON.stringify(outputs).includes("Owned notification destination rejected"));
    }
    for (const method of ["GET", "POST", "PUT", "DELETE"])
      assert.equal((await runtime.dispatchFetch("https://test.invalid/public", { method })).status, 404);
    const before = await call({ op: "journal", id: "local-success" });
    await runtime.setOptions({ workers: [{ config }] });
    assert.deepEqual(await call({ op: "journal", id: "local-success" }), before, "Read-only reload never resets or advances the journal");
  } finally { await runtime.dispose(); }
});
