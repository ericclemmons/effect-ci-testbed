import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { realpathSync } from "node:fs";
import test from "node:test";
import { assertionRuntimeSource } from "../../../packages/cloudflare-dynamic-worker/src/assertion-source.ts";

test("actual local Workflow preserves failed assertions and requires real successful tail receipts", { timeout: 40000 }, async () => {
  const require = createRequire(import.meta.url), plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  // Only host tooling preparation differs locally: esbuild prepares the genuine
  // same runtime TEXT. All project execution, Workflow/SQLite/RPC and tail
  // callbacks below are real workerd. Native runtime bundling is not claimed.
  const tool = (await build({ stdin: { contents: assertionRuntimeSource, loader: "js", resolveDir: dirname(require.resolve("@vitest/expect")) },
    bundle: true, write: false, format: "esm", platform: "neutral", conditions: ["workerd", "import"] })).outputFiles[0].text;
  const trusted = { mainModule: "trusted/assertions.js", modules: { "trusted/assertions.js": tool } };
  const root = new URL("../../../", import.meta.url).pathname;
  const bridge = (await build({ stdin: { contents: `
    import{AssertionWorkflow}from'./vitest-worker.ts';import{AssertionTail,AssertionJournal}from'./vitest-trace.ts';
    export{AssertionWorkflow,AssertionTail,AssertionJournal};export default{async fetch(r,env,ctx){const p=await r.json();
      if(p.op==='start'){await ctx.exports.AssertionWorkflow.create({id:p.id,params:p.params});return Response.json({started:true});}
      return Response.json(await(await ctx.exports.AssertionWorkflow.get(p.id)).status());
    }};`, loader: "ts", resolveDir: new URL(".", import.meta.url).pathname }, bundle: true, write: false, format: "esm", platform: "neutral",
    external: ["cloudflare:workers", "cloudflare:workflows"], plugins: [{ name: "local-trusted-tool-preparation", setup(b) {
      b.onResolve({ filter: /^@effect-ci-testbed\/cloudflare-dynamic-worker\/tests$/ }, () => ({ path: "prepared", namespace: "owned-preparation" }));
      b.onLoad({ filter: /.*/, namespace: "owned-preparation" }, () => ({ loader: "js", resolveDir: root,
        contents: `import*as Effect from'effect/Effect';import{runPreparedProjectTests}from${JSON.stringify(root + "packages/cloudflare-dynamic-worker/src/prepared-tests.ts")};
          const trusted=${JSON.stringify(trusted)};export const makeProjectTests=(loader,host)=>({run:input=>Effect.tryPromise(()=>runPreparedProjectTests(loader,trusted,input,host))});` }));
    } }] })).outputFiles[0].text;
  const runtime = new Miniflare({ workers: [{ config: { name: "owned-assertion-workflow", compatibilityDate: "2026-10-07",
    compatibilityFlags: ["nodejs_compat"], env: { LOADER: { type: "worker-loader" } },
    exports: { AssertionWorkflow: { type: "workflow", name: "owned-assertion-workflow" },
      AssertionTail: { type: "worker" }, AssertionJournal: { type: "durable-object", storage: "sqlite" } },
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bridge } } },
  } }] });
  const call = async p => (await runtime.dispatchFetch("https://test.invalid", { method: "POST", body: JSON.stringify(p) })).json();
  try {
    // Do NOT run infinite loops locally or manufacture exceededCpu outcomes.
    // CPU enforcement must be established separately on the native platform.
    for (const mode of ["passing", "state-isolation", "assertion-failure", "forbidden-import", "host-filesystem", "invalid"]) {
      const id = "local-assertion-" + mode;
      await call({ op: "start", id, params: mode === "invalid" ? { mode: "passing", source: "forbidden" } : { mode } });
      let h;
      for (let n = 0; n < 600; n++) {
        h = await call({ op: "status", id });
        if (["complete", "errored"].includes(h.status)) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(h.status, ["passing", "state-isolation"].includes(mode) ? "complete" : "errored", JSON.stringify(h));
      const outputs = h.__LOCAL_DEV_STEP_OUTPUTS;
      if (mode === "invalid") { assert.equal(outputs.length, 0); continue; }
      const report = outputs.find(o => o?.tool === "vitest-expect-5.0.3-subset");
      assert.ok(report); assert.match(report.toolDigest, /^[a-f0-9]{64}$/);
      assert.equal(report.containers, 0); assert.equal(report.runtime, "dynamic-worker");
      assert.equal(outputs.find(o => o?.mode === mode)?.validated, true);
      if (["passing", "state-isolation"].includes(mode)) {
        const tails = outputs.find(o => Array.isArray(o?.outcomes)); assert.equal(tails.toolDigest, report.toolDigest);
        assert.equal(tails.outcomes.length, mode === "passing" ? 1 : 2);
        assert.ok(tails.outcomes.every((o, i) => o.owner === id && o.test === i && o.outcome === "ok"));
        assert.ok(report.tests.every(t => t.passed));
      } else {
        assert.equal(report.tests[0].passed, false);
        assert.equal(report.tests[0].failure, mode === "assertion-failure" ? "assertion" : "execution");
        assert.equal(h.error.name, "WorkflowFatalError");
        assert.match(h.error.message, /NonRetryableError/,
          "The platform wraps the non-retryable final failure; the original redacted test result is independently checkpointed");
      }
    }
  } finally { await runtime.dispose(); }
});
