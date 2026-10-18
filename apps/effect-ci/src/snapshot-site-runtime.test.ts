import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { realpathSync } from "node:fs"
import test from "node:test"
const require = createRequire(import.meta.url)
const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
const { build } = require(require.resolve("esbuild", { paths: [plugin] }))
const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }))

test("the deployable snapshot site verifies served bytes and never rewinds on old publication replay", async () => {
  const output = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    export {Site} from '../verification/snapshot-site/site.ts';
    import {servingPolicy,sha256} from '../verification/snapshot-site/site.ts';
    export default {async fetch(request,env,ctx){
      const url=new URL(request.url),site=ctx.exports.Site.getByName('site');
      if(url.pathname==='/publish'){
        try{return Response.json({receipt:await site.publish(url.searchParams.get('owner'),url.searchParams.get('body'))})}
        catch{return Response.json({rejected:true},{status:409})}
      }
      if(url.pathname==='/verify'){
        const bytes=new TextEncoder().encode(url.searchParams.get('body'));
        const manifest={version:1,patterns:['dist/**'],files:[{path:'dist/index.html',size:bytes.length,sha256:await sha256(bytes),executable:false}]};
        return Response.json({verified:await site.verifyCurrent({destination:'site/production',configuration:url.searchParams.has('wrong-policy')?'another policy':servingPolicy,receipt:url.searchParams.get('receipt'),manifest,digest:'not trusted as a content claim'})});
      }
      return site.fetch(request);
    }};` }, bundle: true, write: false, format: "esm", platform: "neutral", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:workers", "node:*"] })
  const runtime = new Miniflare({ workers: [{ config: { name: "snapshot-site-publication", compatibilityDate: "2026-10-07",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    exports: { Site: { type: "durable-object", storage: "sqlite" } },
  } }] })
  const call = (path: string, method = "GET") => runtime.dispatchFetch("https://site.invalid" + path, { method })
  try {
    assert.equal((await call("/")).status, 404)
    const first = await (await call("/publish?owner=first&body=first%20output")).json()
    assert.equal(await (await call("/")).text(), "first output")
    assert.equal((await call("/")).headers.get("content-security-policy"), "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
    const verify = async (receipt: string, body: string, extra = "") =>
      (await (await call(`/verify?receipt=${receipt}&body=${encodeURIComponent(body)}${extra}`)).json()).verified
    assert.equal(await verify(first.receipt, "first output"), true)
    assert.equal(await verify(first.receipt, "wrong snapshot"), false)
    assert.equal(await verify(first.receipt, "first output", "&wrong-policy"), false)
    await call("/publish?owner=second&body=new%20output")
    assert.deepEqual(await (await call("/publish?owner=first&body=first%20output")).json(), first)
    assert.equal(await (await call("/")).text(), "new output", "Old replay retains its receipt without changing current publication")
    assert.equal(await verify(first.receipt, "first output"), false)
    assert.equal((await call("/publish?owner=first&body=conflicting%20output")).status, 409)
    assert.equal((await call("/other")).status, 404)
    assert.equal((await call("/", "POST")).status, 405)
    assert.equal(await (await call("/", "HEAD")).text(), "")
  } finally { await runtime.dispose() }
})
