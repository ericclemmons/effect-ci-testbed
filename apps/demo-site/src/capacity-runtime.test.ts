import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import test from "node:test";

test("a full legacy registry admits more previews without eviction and enforces the new bound atomically", { timeout: 30000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const bundle = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {DemoSiteRevisions} from './worker.ts';export {DemoSiteRevisions};
    export default {async fetch(request,env,ctx){
      const r=ctx.exports.DemoSiteRevisions.getByName('local-capacity-regression');
      const p=await request.json();
      if(p.operation==='inspect')return Response.json(await r.inspect(p.revision));
      try{return Response.json(await r.publish(p.revision,p.assets));}catch{return new Response('Rejected',{status:422});}
    }};` }, bundle: true, write: false, format: "esm", target: "esnext", external: ["cloudflare:*", "node:*"] });
  const config = { name: "local-site-capacity", compatibilityDate: "2026-10-07", manifest: {
    mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
    exports: { DemoSiteRevisions: { type: "durable-object", storage: "sqlite" } } };
  const runtime = new Miniflare({ workers: [{ config }] });
  const assets = { "index.html": "<h1>Local capacity fixture</h1>", "app.js": "export const x=1", "message.js": "export const message='local'" };
  const revision = (n: number) => n.toString(16).padStart(40, "0");
  const send = (body: unknown) => runtime.dispatchFetch("https://local.invalid/", { method: "POST", body: JSON.stringify(body) });
  const publish = (n: number) => send({ revision: revision(n), assets });
  try {
    for (let n = 0; n < 32; n++) assert.equal((await publish(n)).status, 200);
    const first = await (await publish(0)).json();
    assert.equal((await publish(32)).status, 200, "The 33rd immutable preview must work without deleting the original 32");
    for (let n = 33; n < 254; n++) assert.equal((await publish(n)).status, 200);
    const results = await Promise.all([254, 255, 256, 257].map(publish));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 200, 422, 422]);
    assert.equal((await publish(258)).status, 422, "The registry remains bounded");
    assert.deepEqual(await (await publish(0)).json(), first, "Original exact-byte receipt survives a full registry");
    assert.equal((await send({ revision: revision(0), assets: { ...assets, "message.js": "changed" } })).status, 422);
    await runtime.setOptions({ workers: [{ config }] });
    assert.deepEqual(await (await send({ operation: "inspect", revision: revision(0) })).json(),
      { revision: revision(0), count: 256, capacity: 256, present: true });
    assert.deepEqual(await (await publish(0)).json(), first, "Reload retains the original receipt");
  } finally { await runtime.dispose(); }
});
