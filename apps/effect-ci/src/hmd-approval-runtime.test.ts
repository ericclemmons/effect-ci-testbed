import assert from "node:assert/strict"
import { realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
const require = createRequire(import.meta.url)
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }))
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }))
test("actual SQLite approval consumes once; expired, stale and lost event ack cannot resend", { timeout: 30_000 }, async () => {
  const output = await build({ stdin: { contents: `
    import {WorkerEntrypoint,RpcTarget} from "cloudflare:workers";
    export {HmdApprovals} from "./hmd-approval.ts";
    const events=[];let renewals=0;let verified=0;
    // Test-only expiry clock: CI scheduling must not consume the 50ms fixture window.
    const wallNow=Date.now.bind(Date);let expiryNow=null;
    Date.now=()=>expiryNow===null?wallNow():expiryNow;
    class Instance extends RpcTarget {
      constructor(owner,destination='lab'){super();this.owner=owner;this.destination=destination}
      status(){return {status:"waiting"}}
      sendEvent(event){events.push({owner:this.owner,destination:this.destination,...event});if(this.owner==="lost")throw new Error("Lost event acknowledgement")}
    }
    export class HmdReviewWorkflow extends WorkerEntrypoint {get(owner){return new Instance(owner)}}
    export class DemoCIWorkflow extends WorkerEntrypoint {get(owner){return new Instance(owner,'demo')}}
    export class Broker extends WorkerEntrypoint {renew(){renewals++}promote(){verified++}}
    export default {async fetch(req,env){
      const p=await req.json();const stub=env.REVIEWS.getByName(p.owner??"run");
      if(p.operation==="read-demo"){try{return Response.json(await stub.readDemoDecision(p.owner,p.phase,p.snapshot));}catch{return Response.json({rejected:true});}}
      if(p.operation==="cross-register"){try{await stub.register(p.owner,10,'a'.repeat(64),Date.now()+300000);return Response.json({rejected:false});}catch{return Response.json({rejected:true});}}
      if(p.operation==="register"||p.operation==="register-demo") {
        if(p.owner==="expired")expiryNow=wallNow();
        const deadline=Date.now()+(p.ttl??300000);
        if(p.owner==="expired")await new Promise(resolve=>setTimeout(resolve,75));
        const cap=await stub[p.operation==='register-demo'?'registerDemo':'register'](p.owner??"run",p.phase??10,p.snapshot??"a".repeat(64),deadline);
        return Response.json({owner:cap.owner,phase:cap.phase,snapshot:cap.snapshot,token:cap.token});
      }
      if(p.operation==="advance-expiry"){expiryNow+=p.ms;return Response.json({advanced:true})}
      if(p.operation==="submit")return Response.json(await Promise.all([stub.submit(p.cap,p.decision??"approved","Test-only rationale","slack:T1:U1"),stub.submit(p.cap,p.decision??"approved","Test-only rationale","slack:T1:U1")]));
      if(p.operation==="inspect")return Response.json(await stub.inspect(p.cap));
      if(p.operation==="close"){await stub.close(p.owner??"run");return Response.json({closed:true})}
      return Response.json({events,renewals,verified});
    }};
  `, resolveDir: new URL(".", import.meta.url).pathname, sourcefile: "review-probe.ts", loader: "ts" },
    bundle: true, write: false, format: "esm", target: "esnext", external: ["cloudflare:workers"] })
  const name = "hmd-review-ledger-probe"
  const runtime = new Miniflare({ workers: [{ config: { name, compatibilityDate: "2026-10-07",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    exports: { HmdApprovals: { type: "durable-object", storage: "sqlite" }, HmdReviewWorkflow: { type: "worker" }, DemoCIWorkflow: { type: "worker" }, Broker: { type: "worker" } },
    env: { REVIEWS: { type: "durable-object", worker: name, exportName: "HmdApprovals" }, RELEASE_MANAGER: { type: "worker", worker: name, exportName: "Broker" },
      SLACK_APP_ID: { type: "json", value: "A1" }, SLACK_TEAM_ID: { type: "json", value: "T1" }, SLACK_CHANNEL_ID: { type: "json", value: "C1" } },
  } }] })
  const send = async (body: unknown) => {
    const response = await runtime.dispatchFetch("https://probe.invalid", { method: "POST", body: JSON.stringify(body) })
    assert.equal(response.status, 200, await response.clone().text())
    return response.json()
  }
  try {
    const cap = await send({ operation: "register" })
    assert.match(cap.token, /^[a-f0-9]{64}$/)
    assert.equal(await send({ operation: "inspect", cap }), true)
    assert.equal(await send({ operation: "inspect", cap: { ...cap, snapshot: "b".repeat(64) } }), false)
    const results = await send({ operation: "submit", cap })
    assert.deepEqual([...results].sort(), [false, true])
    assert.equal(await send({ operation: "inspect", cap }), false)
    // Wait only for mocked RPC delivery, not a health gate or a real deployment.
    let state
    for (let i = 0; i < 20; i++) {
      state = await send({ operation: "state" })
      if (state.events.length === 1) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(state.events.length, 1)
    assert.equal(state.renewals, 1)
    assert.equal(state.verified, 1)
    assert.equal(state.events[0].type, "hmd-review-10")
    assert.equal(state.events[0].destination,"lab","old lab destination stays unchanged")
    const demo=await send({operation:"register-demo",owner:"demo-owned"})
    assert.deepEqual(await send({operation:"read-demo",owner:"demo-owned",phase:10,snapshot:demo.snapshot}),{rejected:true},"unconsumed events are not authority")
    assert.deepEqual(await send({operation:"cross-register",owner:"demo-owned"}),{rejected:true},"host destination cannot change")
    await send({operation:"submit",owner:"demo-owned",cap:demo})
    let demoState
    for(let n=0;n<30;n++){demoState=await send({operation:"state"});if(demoState.events.some((e:any)=>e.owner==='demo-owned'))break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(demoState.events.find((e:any)=>e.owner==='demo-owned').destination,'demo')
    const decision=await send({operation:"read-demo",owner:"demo-owned",phase:10,snapshot:demo.snapshot})
    assert.equal(decision.decision,'approved');assert.equal(decision.actor,'slack:T1:U1')
    assert.deepEqual(await send({operation:"read-demo",owner:"demo-owned",phase:10,snapshot:'b'.repeat(64)}),{rejected:true})
    assert.equal(state.events[0].payload.snapshot, cap.snapshot)
    assert.deepEqual(await send({ operation: "submit", cap }), [false, false])
    await send({ operation: "close" })
    const next = await send({ operation: "register", phase: 25, snapshot: "c".repeat(64) })
    assert.equal(await send({ operation: "inspect", cap }), false)
    assert.equal(await send({ operation: "inspect", cap: next }), true)
    await send({ operation: "close" })
    const skipped = await send({ operation: "register", phase: 100, snapshot: "d".repeat(64) })
    assert.equal(await send({ operation: "inspect", cap: skipped }), true, "clear-health phases need not request review")
    assert.equal(await send({ operation: "inspect", cap: next }), false)
    const lost = await send({ operation: "register", owner: "lost" })
    await send({ operation: "submit", owner: "lost", cap: lost, decision: "rejected" })
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.deepEqual(await send({ operation: "submit", owner: "lost", cap: lost }), [false, false])
    const expired = await send({ operation: "register", owner: "expired", ttl: 50 })
    assert.equal(await send({ operation: "inspect", owner: "expired", cap: expired }), true)
    await send({ operation: "advance-expiry", ms: 50 })
    assert.equal(await send({ operation: "inspect", owner: "expired", cap: expired }), false)
    assert.deepEqual(await send({ operation: "submit", owner: "expired", cap: expired }), [false, false])
    const final = await send({ operation: "state" })
    assert.deepEqual(final.events.map((e:any)=>e.owner), ["run","demo-owned","lost"])
    assert.equal(final.renewals, 2, "only the lab and demo approvals renew; rejection never promotes or renews")
  } finally { await runtime.dispose() }
})
