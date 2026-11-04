import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { demoSite } from "@effect-ci-testbed/cloudflare/demo-site";
const assets = {
    "index.html": "<h1>Vite</h1>",
    "app.js": "export const x=1",
    "message.js": 'export const message="hello"',
  },
  revision = "a".repeat(40);
test(
  "real broker SQLite/RPC serializes one fake version upload, replays after reload and blocks active-release preparation",
  { timeout: 30000 },
  async () => {
    const require = createRequire(import.meta.url),
      plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
    const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
    const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
    const site = await demoSite(revision, assets);
    const bundle = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        loader: "ts",
        contents: `
 import{ReleaseJournalObject}from'./worker.ts';
 import{RELEASE_SCRIPT}from'./release-manager.ts';
 let posts=0,metadata;
 globalThis.fetch=async(raw,init)=>{
  const url=String(raw);
  if(url.startsWith('https://effect-ci-demo-site.'))return new Response(${JSON.stringify(assets)}[url.split('/').at(-1)],{headers:{'x-site-revision':'${revision}','x-site-digest':'${site.digest}'}});
  if(!url.startsWith('https://api.cloudflare.com/client/v4/accounts/da2f8f3e41d6b5018df12a58b417d918/workers/scripts/effect-ci-hmd-demo/'))throw Error('Foreign credential target');
  if(new Headers(init.headers).get('authorization')!=='Bearer fake-token')throw Error('Wrong token');
  if(url.includes('/deployments')){if(init.method==='POST')throw Error('Must never deploy');return Response.json({success:true,result:{deployments:[{id:'22222222-2222-4222-8222-222222222222',versions:[{version_id:'33333333-3333-4333-8333-333333333333',percentage:100}]}]}});}
  if(init.method==='POST'){posts++;metadata=JSON.parse(await init.body.get('metadata').text());return Response.json({success:true,result:{id:'11111111-1111-4111-8111-111111111111'}});}
  return Response.json({success:true,result:{id:'11111111-1111-4111-8111-111111111111',metadata:{source:'api'},annotations:metadata.annotations,resources:{bindings:metadata.bindings}}});
 };
 export class Journal extends ReleaseJournalObject{async pending(){const r=await this.ctx.storage.get('candidate:${revision}');await this.ctx.storage.put('candidate:${revision}',{...r,status:'pending',receipt:undefined});}async seed(){await this.ctx.storage.put('release',{status:'active'});}async inspect(){return {index:await this.ctx.storage.get('candidate-index-v1'),record:await this.ctx.storage.get('candidate:${revision}'),posts};}}
 export default{async fetch(request,env){const p=await request.json();const j=env.JOURNAL.getByName(RELEASE_SCRIPT);try{if(p.op==='pending'){await j.pending();return Response.json({ok:true});}if(p.op==='reconcile')return Response.json(await j.reconcileCandidate(p.revision,p.digest,'11111111-1111-4111-8111-111111111111'));if(p.op==='seed'){await j.seed();return Response.json({ok:true});}if(p.op==='inspect')return Response.json(await j.inspect());return Response.json(await j.prepareCandidate(p.revision,p.digest));}catch(e){return Response.json({error:e.message},{status:422});}}};
 `,
      },
      bundle: true,
      write: false,
      format: "esm",
      target: "esnext",
      external: ["cloudflare:*", "node:*"],
    });
    const config = {
      name: "candidate-probe",
      compatibilityDate: "2026-10-07",
      manifest: {
        mainModule: "index.js",
        modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } },
      },
      exports: { Journal: { type: "durable-object", storage: "sqlite" } },
      env: {
        HMD_DEPLOY_TOKEN: { type: "text", value: "fake-token" },
        JOURNAL: { type: "durable-object", worker: "candidate-probe", exportName: "Journal" },
      },
    };
    const runtime = new Miniflare({ workers: [{ config }] });
    const call = (body: any) =>
      runtime.dispatchFetch("https://probe.invalid", {
        method: "POST",
        body: JSON.stringify(body),
      });
    try {
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => call({ revision, digest: site.digest })),
      );
      for (const response of responses) {
        assert.equal(response.status, 200);
        assert.equal((await response.json()).version, "11111111-1111-4111-8111-111111111111");
      }
      let state = await (await call({ op: "inspect" })).json();
      assert.equal(state.posts, 1);
      assert.deepEqual(state.index, [revision]);
      assert.equal(state.record.status, "complete");
      await call({ op: "pending" });
      assert.equal(
        (await call({ revision, digest: site.digest })).status,
        422,
        "pending prepare must hold",
      );
      assert.equal((await call({ op: "reconcile", revision, digest: site.digest })).status, 200);
      state = await (await call({ op: "inspect" })).json();
      assert.equal(state.posts, 1, "reconciliation must not upload again");
      assert.equal(state.record.status, "complete");
      await runtime.setOptions({ workers: [{ config }] });
      assert.equal((await call({ revision, digest: site.digest })).status, 200);
      assert.equal((await call({ revision, digest: "b".repeat(64) })).status, 422);
      state = await (await call({ op: "inspect" })).json();
      assert.equal(state.record.status, "complete");
      assert.equal(state.posts, 0, "reload replay must not upload again");
      await call({ op: "seed" });
      assert.equal((await call({ revision: "c".repeat(40), digest: site.digest })).status, 422);
    } finally {
      await runtime.dispose();
    }
  },
);
