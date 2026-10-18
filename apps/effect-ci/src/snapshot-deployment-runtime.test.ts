import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { realpathSync } from "node:fs"
import test from "node:test"
const require = createRequire(import.meta.url)
const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
const { build } = require(require.resolve("esbuild", { paths: [plugin] }))
const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }))

test("snapshot-backed changed compares output with successful deployed state across runs", { timeout: 30_000 }, async () => {
  // Actual core, RPC, SQLite baseline and HTTP publication. The immutable
  // container snapshot backend is simulated; the fixed reader has real-filesystem tests.
  const compiled = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {DurableObject} from 'cloudflare:workers';
    import * as CI from '@effect-ci-testbed/ci';
    import {makeRunner,workflowEntrypoint} from '@effect-ci-testbed/cloudflare';
    import {snapshotDeployment} from '@effect-ci-testbed/cloudflare/snapshot-deployment';
    export {SnapshotDeploymentBaselines} from '@effect-ci-testbed/cloudflare/snapshot-deployment';
    const snapshots=new Map();let sequence=0;
    async function manifest(files,patterns){
      const entries=[];
      for(const [path,text] of Object.entries(files)){
        const bytes=new TextEncoder().encode(text);
        const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
        entries.push({path,size:bytes.length,sha256,executable:false});
      }
      return {version:1,patterns,files:entries};
    }
    export class WorkspaceContainer extends DurableObject {
      inspectOutput(snapshot,_cwd,patterns){const files=snapshots.get(snapshot.id);if(!files)throw Error('Snapshot expired');return manifest(files,patterns)}
      exists(){return true}
      checkpoint(_name,_release,commit){return commit.revision}
    }
    export class Site extends DurableObject {
      async publish(body,configuration){const id=crypto.randomUUID();await this.ctx.storage.put({id,body,configuration});return id}
      async matches(request){
        const body=await this.ctx.storage.get('body');
        if(typeof body!=='string'||await this.ctx.storage.get('id')!==request.receipt||await this.ctx.storage.get('configuration')!==request.configuration)return false;
        const actual=await manifest({'dist/index.html':body},['dist/**']);
        return JSON.stringify(actual)===JSON.stringify(request.manifest);
      }
      async fetch(){return new Response(await this.ctx.storage.get('body')??'not deployed')}
    }
    export const OutputWorkflow=workflowEntrypoint(params=>{
      const build=CI.action('build',()=>function*(){return CI.Workspace.remote(params.runId,'/workspace/repository',{provider:'cloudflare-container',value:params.snapshot})});
      const deploy=CI.action('deploy',()=>function*(){return yield* build()});
      return CI.workflow('native-output-selection',function*(){const output=yield* build();if(yield* output.changed('dist/**'))return yield* deploy();return output});
    },{workspaceChanges:(_env,{runner,exports})=>snapshotDeployment({destination:'site/production',configuration:'site-v2',patterns:['dist/**'],runner,
      baselines:exports.SnapshotDeploymentBaselines.getByName('baselines'),verifyCurrent:request=>exports.Site.getByName('site').matches(request)}).changes});
    export default {async fetch(request,env,ctx){
      const url=new URL(request.url),site=ctx.exports.Site.getByName('site');
      if(url.pathname==='/cas'){
        const store=ctx.exports.SnapshotDeploymentBaselines.getByName('cas'),scope='f'.repeat(64);
        const first={snapshot:{kind:'workspace',provider:'cloudflare-container',cwd:'/workspace/repository',snapshot:{id:'cas-first',size:3}},manifest:await manifest({'dist/index.html':'cas'},['dist/**']),receipt:'receipt-first'};
        const accepted=await store.record(scope,undefined,first);
        const stale=await store.record(scope,undefined,{...first,snapshot:{...first.snapshot,snapshot:{id:'cas-stale',size:3}},receipt:'receipt-stale'});
        return Response.json({accepted,stale,current:(await store.current(scope)).snapshot.snapshot.id});
      }
      if(url.pathname==='/native-status')return Response.json(await(await ctx.exports.OutputWorkflow.get('native-skip')).status());
      if(url.pathname==='/native-start'){
        const body=await(await site.fetch(new Request('https://site.invalid/'))).text();
        const snapshot={id:'native-output',size:body.length};snapshots.set(snapshot.id,{'dist/index.html':body});
        await ctx.exports.OutputWorkflow.create({id:'native-skip',params:{repository:'https://github.com/example/site',revision:'a'.repeat(40),runId:'native-skip',snapshot}});
        return Response.json({started:true});
      }
      if(url.pathname==='/site')return site.fetch(new Request('https://site.invalid/'));
      if(url.pathname==='/expire'){snapshots.clear();return Response.json({expired:true})}
      if(url.pathname==='/drift'){await site.publish('outside deployment','site-v2');return Response.json({drifted:true})}
      const body=url.searchParams.get('body')??'first output';
      const id='run-'+(++sequence),snapshot={id:'snapshot-'+sequence,size:body.length};
      snapshots.set(snapshot.id,{'dist/index.html':body});
      const runner=makeRunner({binding:ctx.exports.WorkspaceContainer,workspaceId:id,repository:'https://github.com/example/site',revision:'a'.repeat(40),step:{do:async(_name,...args)=>args.at(-1)()}});
      const configuration=url.searchParams.get('config')??'site-v1';
      const baselines=url.searchParams.has('baseline-outage')?{current:async()=>{throw Error('Baseline unavailable')},record:async()=>{throw Error('Baseline unavailable')}}:ctx.exports.SnapshotDeploymentBaselines.getByName('baselines');
      const destination=snapshotDeployment({destination:'site/production',configuration,patterns:['dist/**'],runner,
        baselines,verifyCurrent:request=>site.matches(request)});
      const workspace=CI.Workspace.remote(id,'/workspace/repository',{provider:'cloudflare-container',value:snapshot});
      if(url.pathname==='/cancel-record'){
        const canceled=snapshotDeployment({destination:'cancellation',configuration,patterns:['dist/**'],baselines,
          runner:{outputs:{...runner.outputs,inspect:()=>Effect.failCause(Cause.fromReasons([Cause.makeFailReason('outage'),Cause.makeInterruptReason(42)]))}},verifyCurrent:async()=>{throw Error('Not reached')}});
        const exit=await Effect.runPromiseExit(CI.run(CI.workflow('cancel-record',()=>canceled.recordSuccessful(workspace,'unused')),{output:'silent'}));
        return Response.json({interrupted:Exit.isFailure(exit)&&Cause.hasInterrupts(exit.cause)});
      }
      const build=CI.action('build',()=>function*(){return workspace});
      let recorded;
      const deploy=CI.action('deploy',()=>function*(){
        const output=yield* build();
        if(url.searchParams.has('fail'))throw Error('Actual deployment refused');
        const receipt=yield* Effect.tryPromise(()=>site.publish(body,configuration));
        let recordOutput=output;
        if(url.searchParams.has('wrong-snapshot')){
          const wrong={id:'wrong-'+id,size:1};snapshots.set(wrong.id,{'dist/index.html':'not the deployed output'});
          recordOutput=CI.Workspace.remote(id,'/workspace/repository',{provider:'cloudflare-container',value:wrong});
        }
        recorded=yield* destination.recordSuccessful(recordOutput,receipt);return output;
      });
      const workflow=CI.workflow('snapshot-site',function*(){
        const output=yield* build();
        if(yield* output.changed('dist/**'))return yield* deploy();return output;
      });
      try{const result=await CI.runPromise(workflow,{output:'silent',workspaceChanges:destination.changes});return Response.json({nodes:result.plan.nodes.map(n=>n.id),recorded})}
      catch{return Response.json({failed:true},{status:409})}
    }};
    import * as Effect from 'effect/Effect';
    import * as Cause from 'effect/Cause';
    import * as Exit from 'effect/Exit';
  ` }, bundle: true, write: false, format: "esm", platform: "neutral", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:workers", "node:*"] })
  const runtime = new Miniflare({ workers: [{ config: { name: "snapshot-site-test", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: compiled.outputFiles[0].text } } },
    exports: { WorkspaceContainer: { type: "durable-object", storage: "sqlite" }, Site: { type: "durable-object", storage: "sqlite" }, SnapshotDeploymentBaselines: { type: "durable-object", storage: "sqlite" }, OutputWorkflow: { type: "workflow", name: "snapshot-output-workflow" } },
  } }] })
  const run = async (query = "") => {
    const response = await runtime.dispatchFetch("https://test.invalid/run" + query)
    return { status: response.status, value: await response.json() }
  }
  try {
    assert.deepEqual(await run(), { status: 200, value: { nodes: ["build", "deploy"], recorded: true } })
    assert.equal(await (await runtime.dispatchFetch("https://test.invalid/site")).text(), "first output")
    assert.deepEqual((await run()).value.nodes, ["build"], "A different snapshot with identical bytes skips deployment")
    assert.equal((await run("?body=changed&fail")).status, 409)
    assert.equal(await (await runtime.dispatchFetch("https://test.invalid/site")).text(), "first output")
    assert.deepEqual((await run("?body=changed")).value.nodes, ["build", "deploy"], "Failed deployment never advances the baseline")
    assert.deepEqual((await run("?body=changed")).value.nodes, ["build"])
    await runtime.dispatchFetch("https://test.invalid/expire")
    assert.deepEqual((await run("?body=changed")).value.nodes, ["build", "deploy"], "An unavailable saved snapshot cannot authorize skipping")
    await runtime.dispatchFetch("https://test.invalid/drift")
    assert.deepEqual((await run("?body=changed")).value.nodes, ["build", "deploy"], "Out-of-band target drift invalidates the successful baseline")
    assert.deepEqual((await run("?body=changed&config=site-v2")).value.nodes, ["build", "deploy"], "Serving configuration is part of deployment identity")
    assert.equal((await run("?body=bound-output&config=site-v2&wrong-snapshot")).value.recorded, false, "A real receipt cannot authorize a different snapshot's bytes")
    assert.deepEqual((await run("?body=bound-output&config=site-v2")).value.nodes, ["build", "deploy"])
    assert.equal((await run("?body=optional-baseline&config=site-v2&baseline-outage")).value.recorded, false)
    assert.equal(await (await runtime.dispatchFetch("https://test.invalid/site")).text(), "optional-baseline", "Baseline persistence is optional after successful business publication")
    assert.deepEqual((await run("?body=optional-baseline&config=site-v2")).value.nodes, ["build", "deploy"])
    assert.deepEqual(await (await runtime.dispatchFetch("https://test.invalid/cas")).json(), { accepted: true, stale: false, current: "cas-first" }, "A stale recorder cannot replace a newer baseline generation")
    assert.deepEqual(await (await runtime.dispatchFetch("https://test.invalid/cancel-record")).json(), { interrupted: true }, "A baseline outage must not swallow simultaneous cancellation")
    await runtime.dispatchFetch("https://test.invalid/native-start")
    let completed = false
    for (let attempt = 0; attempt < 200; attempt++) {
      const status = await (await runtime.dispatchFetch("https://test.invalid/native-status")).json()
      assert.notEqual(status.status, "errored", JSON.stringify(status.error))
      if (status.status === "complete") {
        assert.deepEqual(status.output.nodes.map((node: { id: string }) => node.id), ["build"], "Native entrypoints must forward the destination comparison")
        completed = true; break
      }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.equal(completed, true)
  } finally { await runtime.dispose() }
})
