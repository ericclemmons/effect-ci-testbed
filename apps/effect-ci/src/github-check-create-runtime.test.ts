import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { realpath } from "node:fs/promises"

test("real Workers check creation and reconciliation refuse redirects without rejecting valid requests", async () => {
  const require = createRequire(import.meta.url)
  const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }))
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }))
  const output = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {createCheck} from '../../../packages/github/src/index.ts';
    export default {async fetch(request){
      const name=new URL(request.url).pathname.slice(1);
      try {return Response.json(await createCheck({token:'fixture-token',repository:'owner/repo',sha:'a'.repeat(40),
        name,title:name,summary:'queued',externalId:name,appSlug:'fixture-app'}));}
      catch(error){return new Response(error.message,{status:502});}
    }};
  ` }, bundle: true, format: "esm", platform: "neutral", external: ["node:*"], target: "esnext", write: false })
  const runtime = new Miniflare({ workers: [
    { config: { name: "check-client", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"], exports: {},
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } } },
      dev: { outboundService: { type: "worker", worker: "github-fixture" } } },
    { config: { name: "github-fixture", compatibilityDate: "2026-10-07", exports: {},
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: `
        const created=new Map();
        export default {async fetch(request){
          const url=new URL(request.url);
          if(url.hostname!=='api.github.com')throw Error('Redirect followed with credentials');
          if(request.redirect!=='manual')throw Error('Unsupported redirect policy');
          if(request.headers.get('authorization')!=='Bearer fixture-token')return new Response('',{status:401});
          if(request.method==='POST'){
            const body=await request.json();
            if(body.name==='post-redirect')return Response.redirect('https://untrusted.invalid/',302);
            created.set(body.name,{...body,id:42,html_url:'https://github.com/owner/repo/runs/42',app:{slug:'fixture-app'}});
            return body.name==='success'?Response.json(created.get(body.name),{status:201}):new Response('',{status:500});
          }
          const name=url.searchParams.get('check_name');
          if(name==='history-redirect')return Response.redirect('https://untrusted.invalid/',302);
          return Response.json({total_count:1,check_runs:[created.get(name)]});
        }};
      ` } } } } },
  ] })
  try {
    for (const name of ["success", "reconcile"]) {
      const response = await runtime.dispatchFetch(`https://client.invalid/${name}`)
      const body = await response.text()
      assert.equal(response.status, 200, body)
      assert.equal(JSON.parse(body).id, 42)
    }
    for (const [name, message] of [["post-redirect", /create check failed \(302\)/], ["history-redirect", /history unavailable/]] as const) {
      const response = await runtime.dispatchFetch(`https://client.invalid/${name}`)
      assert.equal(response.status, 502)
      assert.match(await response.text(), message)
    }
  } finally { await runtime.dispose() }
})
