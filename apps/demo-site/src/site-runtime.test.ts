import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import test from "node:test";
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
    import handler,{DemoSitePublisher,DemoSiteRevisions} from './worker.ts';
    export {DemoSitePublisher,DemoSiteRevisions};
    export default {async fetch(request,env,ctx){
      if(new URL(request.url).pathname==='/test-only-publish') {
        const p=await request.json();try{return Response.json(await ctx.exports.DemoSitePublisher({}).publish(p.revision,p.assets));}catch{return new Response('Rejected',{status:422});}
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
      external: ["cloudflare:workers", "node:*"],
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
      },
    };
    const runtime = new Miniflare({ workers: [{ config }] });
    const assets = {
        "index.html": "<h1>Same Vite build</h1>",
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
