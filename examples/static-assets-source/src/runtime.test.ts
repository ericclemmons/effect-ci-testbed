import assert from "node:assert/strict";
import { realpathSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import test from "node:test";
import { parameters } from "./parameters.ts";
import { staticBuildToolSource } from "../../../packages/cloudflare-dynamic-worker/src/static-build-source.ts";

test("parameters reject mutable/foreign authority and never invoke accessors", () => {
  const revision = "a".repeat(40);
  assert.deepEqual(parameters({ revision, mode: "publish" }), { revision, mode: "publish" });
  assert.deepEqual(parameters({ revision, mode: "build" }), { revision, mode: "build" });
  assert.deepEqual(parameters({ revision, mode: "build-checks" }), { revision, mode: "build-checks" });
  for (const input of [null, { revision, mode: "publish", target: "foreign" }, { revision: "main", mode: "publish" }, { revision, mode: "reset" }, { revision, mode: "publish", [Symbol()]: true }]) assert.throws(() => parameters(input));
  let invoked = 0;
  assert.throws(() => parameters({ mode: "publish", get revision() { invoked++; return revision; } }));
  assert.equal(invoked, 0);
});

test("actual local Workflow/SQLite/private RPC composition publishes once with fake API and source", { timeout: 60000 }, async () => {
  const require = createRequire(import.meta.url), root = new URL("../", import.meta.url).pathname;
  const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  // Local preparation bundles the pinned compiler only. The actual shared
  // adapter, fresh child, Workflow, journal, RPC and uploader below still run.
  const shared = new URL("../../../packages/cloudflare-dynamic-worker/", import.meta.url).pathname;
  const bundler = realpathSync(shared + "node_modules/@cloudflare/worker-bundler");
  const compiler = require.resolve("sucrase", { paths: [bundler] });
  const tool = (await build({ stdin: { contents: staticBuildToolSource, loader: "js", resolveDir: dirname(compiler) },
    bundle: true, write: false, format: "esm", platform: "browser", conditions: ["browser", "import"], minify: true })).outputFiles[0].text;
  const trusted = { mainModule: "compiler.js", modules: { "compiler.js": tool } };
  const code = (await build({ stdin: { resolveDir: root, loader: "ts", contents: `
    import {WorkerEntrypoint} from 'cloudflare:workers';
    import {StaticAssetsWorkflow as HostedWorkflow} from './src/worker.ts';
    import {staticAssetsCsp} from '@effect-ci-testbed/cloudflare/static-assets-publish';
    export {StaticAssetRevisions} from './src/worker.ts';
    export class StaticAssetsWorkflow extends HostedWorkflow {async run(event,step){
      return super.run(event,{do:(...args)=>step.do(...args),sleep:async(name,duration)=>{
        if(name!=='assets:fixed-convergence'||duration!=='30 seconds')throw Error('Unexpected convergence policy');
      }});
    }}
    const revision='${"a".repeat(40)}',version='00000000-0000-0000-0000-000000000001',deployment='00000000-0000-0000-0000-000000000002';
    let rejectApi=false,reads=0,writes=0,metadata,moduleText,served={},identity,active={id:'00000000-0000-0000-0000-000000000003',versions:[{version_id:'00000000-0000-0000-0000-000000000004',percentage:100}]};
    export class SourceReader extends WorkerEntrypoint{
    async readBuild(rev){
      if(!['${"d".repeat(40)}','${"e".repeat(40)}','${"f".repeat(40)}'].includes(rev))throw Error('Foreign build source');reads++;
      const source=rev==='${"e".repeat(40)}'?'const = ;':rev==='${"f".repeat(40)}'?'x'.repeat(32769):'const message: string = "Built"; document.querySelector("#result").textContent = message;';
      const bytes=new TextEncoder().encode(JSON.stringify({version:1,files:['app.ts','index.html','style.css'].map(name=>({path:'site/'+name,base64:btoa(name==='app.ts'?source:name),executable:false}))}));
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
      return {revision:rev,manifestDigest:digest,bytes};
    }
    async read(rev){
      if(![revision,'${"c".repeat(40)}'].includes(rev))throw Error('Foreign source');reads++;
      const bytes=new TextEncoder().encode(JSON.stringify({version:1,files:['app.js','index.html','style.css'].map(name=>({path:'site/'+name,base64:btoa(name),executable:false}))}));
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
      return {revision:rev,manifestDigest:digest,bytes};
    }}
    globalThis.fetch=async(input,init={})=>{
      const url=String(input),method=init.method??'GET',auth=new Headers(init.headers).get('authorization');
      const result=(value,status=200)=>Response.json({success:true,result:value},{status});
      if(!url.startsWith('https://api.cloudflare.com/')){
        if(auth)throw Error('Credential leaked to public assets');
        if(url.endsWith('/__proof'))return Response.json(identity);
        return new Response(served[url.slice(url.lastIndexOf('/')+1)]??'missing',{headers:{'content-security-policy':staticAssetsCsp,'x-content-type-options':'nosniff'}});
      }
      if(method==='POST')writes++;
      if(url.endsWith('/assets-upload-session')){
        if(rejectApi)return new Response('private reflected fake-private-token',{status:403});
        if(auth!=='Bearer fake-private-token')throw Error('Wrong account credential');
        const manifest=JSON.parse(init.body).manifest;return result({jwt:'fake-session',buckets:[Object.values(manifest).map(v=>v.hash)]});
      }
      if(url.endsWith('/assets/upload?base64=true')){
        if(auth!=='Bearer fake-session')throw Error('Account credential entered asset upload');
        for(const [hash,file]of init.body.entries())served[file.name]=atob(await file.text());
        return result({jwt:'fake-completion'},201);
      }
      if(url.endsWith('/versions')&&method==='POST'){
        metadata=JSON.parse(await init.body.get('metadata').text());moduleText=await init.body.get('index.js').text();
        if(metadata.assets.jwt!=='fake-completion')throw Error('Completion token mismatch');
        const marker='JSON.stringify(',start=moduleText.indexOf(marker)+marker.length,end=moduleText.indexOf('),{headers:',start);
        identity=JSON.parse(moduleText.slice(start,end));return result({id:version});
      }
      if(url.endsWith('/versions/'+version))return result({id:version,annotations:metadata.annotations,resources:{bindings:metadata.bindings}});
      if(url.endsWith('/deployments?per_page=1'))return result({deployments:[active]});
      if(url.endsWith('/deployments')&&method==='POST'){const body=JSON.parse(init.body);active={id:deployment,versions:body.versions,annotations:body.annotations};return result(active);}
      throw Error('Unexpected test request');
    };
    export default class extends WorkerEntrypoint{async fetch(request){const p=await request.json();
      if(p.mode==='reject-api'){rejectApi=true;return Response.json({configured:true});}
      if(p.mode==='start'){await this.ctx.exports.StaticAssetsWorkflow.create({id:p.id,params:p.params});return Response.json({started:true});}
      if(p.mode==='status')return Response.json(await(await this.ctx.exports.StaticAssetsWorkflow.get(p.id)).status());
      return Response.json({reads,writes,active,moduleHasCredential:!!moduleText&&moduleText.includes('fake-private-token'),servedApp:served['app.js']});
    }}
  ` }, bundle: true, write: false, format: "esm", platform: "neutral", conditions: ["workerd", "import"], external: ["node:*", "cloudflare:workers", "cloudflare:workflows"],
    plugins: [{ name: "local-host-compiler-preparation", setup(b: any) {
      b.onResolve({ filter: /^@effect-ci-testbed\/cloudflare-dynamic-worker\/static-build$/ }, () => ({ path: "prepared", namespace: "owned-compiler" }));
      b.onLoad({ filter: /.*/, namespace: "owned-compiler" }, () => ({ loader: "js", resolveDir: shared, contents:
        `import{runPreparedStaticBuild}from${JSON.stringify(shared + "src/prepared-static-build.ts")};import{runStaticBuildIsolation}from${JSON.stringify(shared + "src/static-build-isolation.ts")};const trusted=${JSON.stringify(trusted)};export const buildStaticTypeScript=(loader,source)=>runPreparedStaticBuild(loader,trusted,source);export const verifyStaticBuildIsolation=(loader,parent)=>runStaticBuildIsolation(loader,trusted,parent);` }));
    } }] })).outputFiles[0].text;
  const runtime = new Miniflare({ workers: [{ config: { name: "static-assets-wrapper-test", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    exports: { StaticAssetsWorkflow: { type: "workflow", name: "static-assets-local" }, StaticAssetRevisions: { type: "durable-object", storage: "sqlite" }, SourceReader: { type: "worker" } },
    env: { STATIC_ASSETS_DEPLOY_TOKEN: { type: "text", value: "fake-private-token" }, SOURCE_READER: { type: "worker", worker: "static-assets-wrapper-test", exportName: "SourceReader" }, LOADER: { type: "worker-loader" } },
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: code } } } } }] });
  const call = async (body: object): Promise<any> => (await runtime.dispatchFetch("https://test.invalid", { method: "POST", body: JSON.stringify(body) })).json();
  const run = async (id: string, params: unknown) => {
    await call({ mode: "start", id, params });
    for (let i = 0; i < 200; i++) { const status = await call({ mode: "status", id });
      if (["complete", "errored"].includes(status.status)) return status;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw Error("Local static publication did not settle");
  };
  try {
    const revision = "a".repeat(40), result = await run("publish", { revision, mode: "publish" });
    assert.equal(result.status, "complete", JSON.stringify(result));
    assert.equal(result.output.containers, 0); assert.equal(result.output.plan.nodes.length, 3);
    assert.ok(result.output.plan.nodes.every((node: any) => node.status === "complete" && node.commands.length === 0));
    assert.equal(result.output.receipt.version, "00000000-0000-0000-0000-000000000001");
    assert.equal((await call({ mode: "stats" })).writes, 4);
    assert.equal((await call({ mode: "stats" })).moduleHasCredential, false);
    const reconciled = await run("reconcile", { revision, mode: "reconcile" });
    assert.equal(reconciled.status, "complete"); assert.equal(reconciled.output.externalWrites, 0);
    assert.equal((await call({ mode: "stats" })).writes, 4);
    const invalid = await run("invalid", { revision, mode: "publish", target: "foreign" });
    assert.equal(invalid.status, "errored"); assert.equal((await call({ mode: "stats" })).reads, 1);
    const built = await run("build", { revision: "d".repeat(40), mode: "build" });
    assert.equal(built.status, "complete", JSON.stringify(built.error)); assert.equal(built.output.containers, 0);
    assert.equal(built.output.receipt.build.tool, "sucrase-3.35.1-typescript");
    assert.notEqual(built.output.receipt.build.sourceManifestDigest, built.output.receipt.manifestDigest);
    assert.equal(built.output.receipt.build.outputManifestDigest, built.output.receipt.manifestDigest);
    const buildStats = await call({ mode: "stats" }); assert.equal(buildStats.writes, 8);
    assert.ok(buildStats.servedApp.includes('const message = "Built"')); assert.ok(!buildStats.servedApp.includes(": string"));
    assert.equal(buildStats.moduleHasCredential, false);
    for (const [id, rev] of [["invalid-typescript", "e".repeat(40)], ["oversize-typescript", "f".repeat(40)]]) {
      const rejectedBuild = await run(id, { revision: rev, mode: "build" });
      assert.equal(rejectedBuild.status, "errored"); assert.equal((await call({ mode: "stats" })).writes, 8, "failed build cannot publish");
      assert.ok(!JSON.stringify(rejectedBuild).includes("fake-private-token"));
    }
    const beforeChecks = await call({ mode: "stats" });
    const isolation = await run("build-isolation", { revision: "b".repeat(40), mode: "build-checks" });
    assert.equal(isolation.status, "complete", JSON.stringify(isolation.error));
    assert.ok(Object.values(isolation.output.checks).every(v => v === true));
    assert.equal(isolation.output.cpuEnforcementMeasured, false); assert.equal(isolation.output.externalWrites, 0);
    assert.ok(isolation.output.parentBundle.bytes > 0); assert.match(isolation.output.parentBundle.sha256, /^[a-f0-9]{64}$/);
    const afterChecks = await call({ mode: "stats" });
    assert.equal(afterChecks.writes, beforeChecks.writes); assert.equal(afterChecks.reads, beforeChecks.reads);
    await call({ mode: "reject-api" });
    const rejected = await run("api-rejected", { revision: "c".repeat(40), mode: "publish" });
    assert.equal(rejected.status, "errored");
    assert.match(rejected.error.message, /Static Assets API unavailable \(HTTP 403\)/);
    assert.doesNotMatch(rejected.error.message, /UnknownError|fake-private-token|reflected/);
  } finally { await runtime.dispose(); }
});

test("standalone host owns config and never imports another app/example implementation", () => {
  for (const path of ["src/worker.ts", "cloudflare.config.ts", ".cloudflare/ci/workflow.ts", "target/worker.ts"])
    assert.doesNotMatch(readFileSync(new URL("../" + path, import.meta.url), "utf8"), /(?:\.\.\/)+(?:apps|examples)\//);
  const config = readFileSync(new URL("../cloudflare.config.ts", import.meta.url), "utf8");
  assert.match(config, /workersDev: false/); assert.doesNotMatch(config, /defineContainer/);
  assert.match(config, /LOADER: bindings\.workerLoader\(\)/);
});
