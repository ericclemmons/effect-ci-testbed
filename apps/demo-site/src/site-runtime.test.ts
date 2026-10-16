import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import test from "node:test";
import { createHash } from "node:crypto";
import { demoSite, demoSiteUrl } from "@effect-ci-testbed/cloudflare/demo-site";
test(
  "real SQLite/RPC publishes once, persists across reload, and public HTTP cannot write",
  { timeout: 30000 },
  async () => {
    const require = createRequire(import.meta.url);
    const plugin = await realpath(
      new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url),
    );
    const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
    const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
    const bundle = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        contents: `
    import handler,{DemoSitePublisher,DemoSiteRevisions,SiteInspectionWorkflow} from './worker.ts';
    export {DemoSitePublisher,DemoSiteRevisions,SiteInspectionWorkflow};
    export default {async fetch(request,env,ctx){
      if(new URL(request.url).pathname==='/test-only-publish') {
        const p=await request.json();try{return Response.json(await ctx.exports.DemoSitePublisher({}).publish(p.revision,p.assets));}catch{return new Response('Rejected',{status:422});}
      }
      if(new URL(request.url).pathname==='/test-only-inspect') {
        const p=await request.json();await ctx.exports.SiteInspectionWorkflow.create({id:p.id,params:p.params});return new Response('Created');
      }
      if(new URL(request.url).pathname==='/test-only-status') {
        return Response.json(await(await ctx.exports.SiteInspectionWorkflow.get(new URL(request.url).searchParams.get('id'))).status());
      }
      return handler.fetch(request,env,ctx);
    }};
  `,
        loader: "ts",
      },
      bundle: true,
      write: false,
      format: "esm",
      target: "esnext",
      external: ["cloudflare:*", "node:*"],
    });
    const config = {
      name: "demo-site-test",
      compatibilityDate: "2026-10-07",
      manifest: {
        mainModule: "index.js",
        modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } },
      },
      exports: {
        DemoSitePublisher: { type: "worker" },
        DemoSiteRevisions: { type: "durable-object", storage: "sqlite" },
        SiteInspectionWorkflow: { type: "workflow", name: "effect-ci-demo-site-inspection" },
      },
    };
    const runtime = new Miniflare({ workers: [{ config }] });
    const assets = {
        "index.html": "<style>h1{color:red}</style><h1>Same Vite build</h1>",
        "app.js": "export const x=1",
        "message.js": 'export const message="hello"',
      },
      revision = "a".repeat(40);
    const publish = (body: any) =>
      runtime.dispatchFetch("https://site.invalid/test-only-publish", {
        method: "POST",
        body: JSON.stringify(body),
      });
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => publish({ revision, assets })),
      );
      for (const result of results) assert.equal(result.status, 200);
      const record = await results[0].json();
      assert.equal(record.url, demoSiteUrl(await demoSite(revision, assets)));
      assert.equal(
        (await publish({ revision, assets: { ...assets, "message.js": "wrong" } })).status,
        422,
      );
      assert.equal((await publish({ revision: "main", assets })).status, 422);
      await runtime.setOptions({ workers: [{ config }] });
      for (const [path, body] of Object.entries(assets)) {
        const response = await runtime.dispatchFetch(record.url.replace("index.html", path));
        assert.equal(response.status, 200);
        assert.equal(await response.text(), body);
        assert.equal(response.headers.get("x-site-digest"), record.digest);
        const csp = response.headers.get("content-security-policy")!;
        assert.match(csp, /connect-src 'none'/);
        assert.ok(!csp.includes("unsafe-inline"));
        if (path === "index.html") assert.ok(csp.includes(`'sha256-${createHash("sha256").update("h1{color:red}").digest("base64")}'`));
      }
      assert.equal((await runtime.dispatchFetch(record.url, { method: "HEAD" })).status, 200);
      assert.equal(
        (await runtime.dispatchFetch(record.url, { method: "POST", body: "replace" })).status,
        405,
      );
      assert.equal(
        (await runtime.dispatchFetch(record.url.replace(record.digest, "b".repeat(64)))).status,
        404,
      );
      assert.equal((await runtime.dispatchFetch(record.url + "?token=anything")).status, 404);
      const inspect = async (id: string, params: unknown) => {
        await runtime.dispatchFetch("https://site.invalid/test-only-inspect", { method: "POST", body: JSON.stringify({ id, params }) });
        for (let i = 0; i < 100; i++) {
          const h: any = await (await runtime.dispatchFetch(`https://site.invalid/test-only-status?id=${id}`)).json();
          if (["complete", "errored"].includes(h.status)) return h;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw Error("Local inspection did not finish");
      };
      const inspected = await inspect("metadata-once", {});
      assert.equal(inspected.status, "complete");
      assert.deepEqual(inspected.output, ["105ce02b81915f845df75cbc20ecc383162b54f6", "4ae41a23fa6a0978c5f58ec60a135b07fc5addd2"].map(revision =>
        ({ revision, count: 1, capacity: 256, present: false })));
      assert.equal((await inspect("reject-actor-source", { revision })).status, "errored");
      assert.equal((await runtime.dispatchFetch("https://site.invalid/inspect")).status, 404);
      assert.equal(await (await runtime.dispatchFetch(record.url)).text(), assets["index.html"], "Inspection leaves immutable assets unchanged");
      const excessive = await publish({ revision: "b".repeat(40), assets: { ...assets, "index.html": "<style>x{}</style>".repeat(9) } });
      assert.equal(excessive.status, 200);
      assert.equal((await runtime.dispatchFetch((await excessive.json()).url)).status, 503,
        "Bounded CSP derivation failure stays inside the public handler's redacted failure response");
      assert.equal(
        (
          await runtime.dispatchFetch("https://site.invalid/publish", {
            method: "POST",
            body: "replace",
          })
        ).status,
        405,
      );
    } finally {
      await runtime.dispose();
    }
  },
);
