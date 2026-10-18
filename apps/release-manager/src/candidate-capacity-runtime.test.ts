import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { demoSite } from "@effect-ci-testbed/cloudflare/demo-site";

test(
  "the broker preserves 32 legacy candidates, admits the 33rd and enforces finite capacity without eviction",
  { timeout: 60_000 },
  async () => {
    const require = createRequire(import.meta.url);
    const plugin = realpathSync(
      new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url),
    );
    const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
    const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
    const assets = {
      "index.html": "<h1>Capacity</h1>",
      "app.js": "export const x=1",
      "message.js": "export const message='capacity'",
    };
    const revision = (n: number) => n.toString(16).padStart(40, "0");
    const site = await demoSite(revision(0), assets);
    const bundle = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        loader: "ts",
        contents: `
    import{ReleaseJournalObject as Base}from'./worker.ts';import{RELEASE_SCRIPT}from'./release-manager.ts';
    let posts=0;const versions=new Map();
    globalThis.fetch=async(raw,init)=>{const url=new URL(String(raw));
      if(url.origin==='https://effect-ci-demo-site.ericclemmons.workers.dev')return new Response(${JSON.stringify(assets)}[url.pathname.split('/').at(-1)],
        {headers:{'x-site-revision':url.pathname.split('/')[2],'x-site-digest':'${site.digest}'}});
      if(!url.href.startsWith('https://api.cloudflare.com/client/v4/accounts/0db135ec469e2f216fcea26426f29755/workers/scripts/effect-ci-hmd-demo/'))throw Error('Wrong target');
      if(new Headers(init.headers).get('authorization')!=='Bearer fixture-token')throw Error('Wrong credential');
      if(url.pathname.endsWith('/deployments')){if(init.method==='POST')throw Error('Must not promote');return Response.json({success:true,result:{deployments:[{id:'22222222-2222-4222-8222-222222222222',versions:[{version_id:'33333333-3333-4333-8333-333333333333',percentage:100}]}]}});}
      if(init.method==='POST'){posts++;const id='11111111-1111-4111-8111-'+posts.toString(16).padStart(12,'0');const metadata=JSON.parse(await init.body.get('metadata').text());versions.set(id,{id,annotations:metadata.annotations,resources:{bindings:metadata.bindings}});return Response.json({success:true,result:{id}});}
      return Response.json({success:true,result:versions.get(url.pathname.split('/').at(-1))});
    };
    export class Journal extends Base{async inspect(){return{index:await this.ctx.storage.get('candidate-index-v1'),records:Array.from(await this.ctx.storage.list({prefix:'candidate:'})),posts};}}
    export default{async fetch(request,env,ctx){const input=await request.json(),journal=ctx.exports.Journal.getByName(RELEASE_SCRIPT);
      if(input.op==='inspect')return Response.json(await journal.inspect());
      try{return Response.json(await journal.prepareCandidate(input.revision,input.digest));}catch(e){return Response.json({error:e.message},{status:422});}
    }};`,
      },
      bundle: true,
      write: false,
      format: "esm",
      target: "esnext",
      external: ["cloudflare:*", "node:*"],
    });
    const config = {
      name: "candidate-capacity-test",
      compatibilityDate: "2026-10-07",
      manifest: {
        mainModule: "index.js",
        modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } },
      },
      exports: { Journal: { type: "durable-object", storage: "sqlite" } },
      env: { HMD_DEPLOY_TOKEN: { type: "text", value: "fixture-token" } },
    };
    const runtime = new Miniflare({ workers: [{ config }] });
    const call = (input: unknown) =>
      runtime.dispatchFetch("https://fixture.invalid", {
        method: "POST",
        body: JSON.stringify(input),
      });
    const prepare = (n: number) => call({ revision: revision(n), digest: site.digest });
    try {
      for (let n = 0; n < 32; n++) assert.equal((await prepare(n)).status, 200);
      const first = await (await prepare(0)).json();
      const legacy = await (await call({ op: "inspect" })).json();
      assert.equal(
        (await prepare(32)).status,
        200,
        "The 33rd candidate must not fail at the legacy lifetime cap",
      );
      for (let n = 33; n < 254; n++) assert.equal((await prepare(n)).status, 200);
      const racing = await Promise.all([254, 255, 256, 257].map(prepare));
      assert.deepEqual(racing.map((response) => response.status).sort(), [200, 200, 422, 422]);
      const full = await (await call({ op: "inspect" })).json();
      assert.equal(full.index.length, 256);
      assert.equal(full.posts, 256);
      assert.deepEqual(
        full.records.slice(0, 32),
        legacy.records,
        "Every original candidate record is retained unchanged",
      );
      assert.deepEqual(await (await prepare(0)).json(), first);
      assert.equal((await call({ revision: revision(0), digest: "b".repeat(64) })).status, 422);
      assert.equal((await prepare(258)).status, 422);
      await runtime.setOptions({ workers: [{ config }] });
      assert.deepEqual(await (await prepare(0)).json(), first);
      const reloaded = await (await call({ op: "inspect" })).json();
      assert.deepEqual(reloaded.records, full.records);
      assert.equal(reloaded.posts, 0);
    } finally {
      await runtime.dispose();
    }
  },
);
