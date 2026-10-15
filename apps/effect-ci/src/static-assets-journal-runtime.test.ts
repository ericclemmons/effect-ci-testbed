import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

test("actual SQLite journal owns immutable source and holds ambiguous writes across reload", { timeout: 60000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const code = (await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {WorkerEntrypoint} from 'cloudflare:workers';
    export {StaticAssetRevisions} from '../../../packages/cloudflare/src/static-assets-journal.ts';
    export default class extends WorkerEntrypoint {async fetch(request){
      const p=await request.json(),j=this.ctx.exports.StaticAssetRevisions.getByName(p.object??'owned');
      try{let r;switch(p.action){
        case 'put':r=await j.put(p.revision,p.digest,new Uint8Array(p.bytes));break;
        case 'get':{const v=await j.get(p.revision);r={revision:v.revision,manifestDigest:v.manifestDigest,assetDigest:v.assetDigest,bytes:[...v.bytes]};break;}
        case 'begin':r=await j.begin(p.revision);break;
        case 'intent':r=await j.intent(p.revision,p.step);break;
        case 'ack':r=await j.acknowledge(p.revision,p.step,p.identity);break;
        case 'inspect':r=await j.inspect(p.revision);break;
        case 'complete':r=await j.complete(p.revision,p.version,p.deployment);break;
        default:throw Error('Unknown test operation');}
        return Response.json({ok:true,result:r??null});
      }catch(e){return Response.json({ok:false,error:e.message});}
    }}
  ` }, bundle: true, write: false, format: "esm", target: "esnext", external: ["cloudflare:workers", "node:*"] })).outputFiles[0].text;
  const config = (contents: string) => ({ name: "static-assets-journal-test", compatibilityDate: "2026-10-07",
    exports: { StaticAssetRevisions: { type: "durable-object", storage: "sqlite" } },
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } } });
  const runtime = new Miniflare({ workers: [{ config: config(code) }] });
  const call = async (payload: object): Promise<any> => (await runtime.dispatchFetch("https://test.invalid", { method: "POST", body: JSON.stringify(payload) })).json();
  const revision = "a".repeat(40), other = "b".repeat(40);
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, files: ["app.js", "index.html", "style.css"].map(name => ({ path: "site/" + name, base64: "aGVsbG8=", executable: false })) }));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const seed = (rev = revision, object = "owned", data = bytes, sha = digest) => call({ action: "put", revision: rev, object, bytes: [...data], digest: sha });
  const version = "00000000-0000-0000-0000-000000000001", deployment = "00000000-0000-0000-0000-000000000002";
  try {
    const seeds = await Promise.all(Array.from({ length: 8 }, () => seed()));
    assert.ok(seeds.every(r => r.ok)); assert.equal(seeds.filter(r => r.result.created).length, 1);
    const changed = new TextEncoder().encode(new TextDecoder().decode(bytes).replaceAll("aGVsbG8=", "d29ybGQ="));
    assert.equal((await seed(revision, "owned", changed, createHash("sha256").update(changed).digest("hex"))).ok, false);
    const begins = await Promise.all(Array.from({ length: 8 }, () => call({ action: "begin", revision })));
    assert.equal(begins.filter(r => r.ok).length, 1);
    assert.equal((await call({ action: "intent", revision, step: "version" })).ok, false);
    assert.equal((await call({ action: "intent", revision, step: "session" })).ok, true);
    assert.equal((await call({ action: "intent", revision, step: "session" })).ok, false);
    await runtime.setOptions({ workers: [{ config: config(code + "\n// reload pending intent\n") }] });
    assert.equal((await call({ action: "inspect", revision })).result.pending, "session");
    assert.equal((await call({ action: "begin", revision })).ok, false);
    await seed(other);
    assert.equal((await call({ action: "begin", revision: other })).ok, false);
    assert.equal((await call({ action: "ack", revision, step: "session", identity: "private-upload-token" })).ok, false);
    assert.equal((await call({ action: "ack", revision, step: "session", identity: digest })).ok, true);
    assert.equal((await call({ action: "intent", revision, step: "assets:1" })).ok, false);
    for (const [step, identity] of [["assets:0", digest], ["version", version], ["deployment", deployment]]) {
      assert.equal((await call({ action: "intent", revision, step })).ok, true);
      assert.equal((await call({ action: "ack", revision, step, identity })).ok, true);
      assert.equal((await call({ action: "intent", revision, step })).ok, false);
    }
    const completed = await call({ action: "complete", revision, version, deployment });
    assert.equal(completed.ok, true); assert.equal(completed.result.target, "effect-ci-static-assets-demo");
    assert.deepEqual((await call({ action: "begin", revision })).result, completed.result);
    assert.equal((await call({ action: "begin", revision: other })).ok, true);
    assert.deepEqual((await call({ action: "get", revision })).result.bytes, [...bytes]);
    for (let i = 0; i < 32; i++) assert.equal((await seed(i.toString(16).padStart(40, "0"), "capacity")).ok, true);
    assert.equal((await seed("f".repeat(40), "capacity")).ok, false);
    assert.equal((await seed("0".repeat(40), "capacity")).result.created, false);
  } finally { await runtime.dispose(); }
});
