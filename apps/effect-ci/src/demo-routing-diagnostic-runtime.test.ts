import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

test("private diagnostic uses real local Workflow/RPC checkpoints, fixed cohorts and mandatory restoration", { timeout: 30000 }, async () => {
  const require = createRequire(import.meta.url), plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const bundle = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import{WorkerEntrypoint}from'cloudflare:workers';
    import{DemoRoutingDiagnosticWorkflow as ActualWorkflow}from'./demo-routing-diagnostic-workflow.ts';
    import{routingDiagnosticCandidate as candidate}from'./demo-routing-diagnostic.ts';
    const baseline='09593237-23b2-4873-bd04-88c8e8488840';let phase=0,calls=0,restores=0,requests=0,waits=[];
    function view(){return{candidate:candidate.version,status:'active',previous:[{version:baseline,percentage:100}],deployment:{id:'11111111-1111-4111-8111-111111111111',versions:phase?[{version:baseline,percentage:90},{version:candidate.version,percentage:10}]:[{version:baseline,percentage:100}]}};}
    export class Broker extends WorkerEntrypoint{prepareCandidate(){calls++;return candidate;}begin(){calls++;return view();}renew(){calls++;return view();}promote(owner,p){calls++;if(p!==10)throw Error('Forbidden phase');phase=p;return view();}rollback(){calls++;restores++;phase=0;return{...view(),status:'rolled-back'};}complete(){throw Error('Forbidden commit');}}
    // TEST ONLY elapsed-time substitute, with actual Workflow/RPC durability.
    export class DemoRoutingDiagnosticWorkflow extends ActualWorkflow{run(event,step){return super.run(event,{do:(...args)=>step.do(...args),sleep:async(name,duration)=>{waits.push({name,duration});}});}}
    globalThis.fetch=async(input,init)=>{requests++;if(!String(input).startsWith('https://effect-ci-hmd-demo.eclemmons.workers.dev/health?'))throw Error('Foreign destination');const key=new Headers(init.headers).get('Cloudflare-Workers-Version-Key'),i=Number(new URL(input).searchParams.get('probe').split('-').at(-1));return Response.json({version:phase&&key&&i<10?candidate.version:baseline,healthy:true});};
    export default{async fetch(request,env,ctx){const p=await request.json();if(p.op==='start'){await ctx.exports.DemoRoutingDiagnosticWorkflow.create({id:p.id,params:p.payload});return Response.json({started:true});}if(p.op==='status')return Response.json(await(await ctx.exports.DemoRoutingDiagnosticWorkflow.get(p.id)).status());return Response.json({phase,calls,restores,requests,waits});}};` }, bundle: true, write: false, format: "esm", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:workers", "node:*"] });
  const runtime = new Miniflare({ workers: [{ config: { name: "routing-diagnostic-test", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"], manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } }, exports: { DemoRoutingDiagnosticWorkflow: { type: "workflow", name: "routing-diagnostic-test" }, Broker: { type: "worker" } }, env: { RELEASE_MANAGER: { type: "worker", worker: "routing-diagnostic-test", exportName: "Broker" } } } }] });
  const call = async (value: unknown): Promise<any> => (await runtime.dispatchFetch("https://test.invalid", { method: "POST", body: JSON.stringify(value) })).json();
  async function terminal(id: string) { for (let n = 0; n < 300; n++) { const s = await call({ op: "status", id }); if (["complete", "errored"].includes(s.status)) return s; await new Promise(r => setTimeout(r, 10)); } throw Error("No terminal diagnostic"); }
  try {
    await call({ op: "start", id: "invalid", payload: { mode: "observe-fixed-candidate", version: "foreign" } });
    assert.equal((await terminal("invalid")).status, "errored");
    assert.equal((await call({})).calls, 0);
    await call({ op: "start", id: "valid", payload: { mode: "observe-fixed-candidate" } });
    const result = await terminal("valid"), state = await call({});
    assert.equal(result.status, "complete", JSON.stringify(result.error));
    assert.equal(result.output.diagnosticComplete, true);
    assert.equal(result.output.releaseCommitted, false);
    assert.equal(result.output.uploadPerformed, false);
    assert.deepEqual(result.output.observations.map((o: any) => o.scheduledSeconds), [0, 30, 120]);
    assert.equal(state.requests, 700);
    assert.equal(state.restores, 1);
    assert.equal(state.phase, 0);
    assert.deepEqual(state.waits.map((w: any) => w.duration), ["30 seconds", "90 seconds"]);
  } finally { await runtime.dispose(); }
});
