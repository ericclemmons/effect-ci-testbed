import assert from "node:assert/strict"
import { realpath, readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { createHmac } from "node:crypto"
import test from "node:test"
const require = createRequire(import.meta.url)
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }))
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }))

/** Native local Workflow+RPC/SQLite/WASM composition, mocked external systems.
 * Automated fixture decisions are NOT human approval or live Slack/Cloudflare deployment proof.
 */
for (const scenario of ["approve", "force-regression", "deadline", "reject", "native-reject", "claim-failure", "delivery-unavailable", "delivery-identity"] as const) {
test(`native hosted HMD composition keeps one card: ${scenario}`, { timeout: 90_000 }, async () => {
  const output = await build({ stdin: { contents: `
    import {WorkerEntrypoint} from "cloudflare:workers";
    import {hmdSlackInteraction} from "./hmd-slack.ts";
    export {HmdReviewWorkflow} from "./hmd-workflow.ts";
    export {HealthChartRenderer} from "./health-renderer.ts";
    export {PrivateSlackImages} from "./private-images.ts";
    export {PrivateSlackCards} from "./private-cards.ts";
    import {HmdApprovals as ActualHmdApprovals} from "./hmd-approval.ts";
    export class HmdApprovals extends ActualHmdApprovals {
      async expire(...args){await super.expire(...args);deadlineExpirations++}
    }
    const baseline="f8526596-f9b8-4068-87c0-c517844488a8",candidate="27fca944-c549-433e-a1d4-15684b1c6cd9";
    let phase=0,files=0,posts=0,updates=0,threadPosts=0,restores=0,modal=null,validationRejects=0,nativeQueries=0,nativeRequests=0,deadlineExpirations=0;
    const promotions=[],frames=[],threadFrames=[],replyIds=new Set();
    const nativeRows=new Map();
    // Test-only clock for the deadline fence, restored before any Workflow starts.
    const wallNow=Date.now.bind(Date);let fenceNow=null;
    Date.now=()=>fenceNow===null?wallNow():fenceNow;
    export class Analytics extends WorkerEntrypoint {
      query(input){
        nativeQueries++;
        if(!input.query.includes("FROM logs.workersLogs")||input.query.includes("accountTag"))throw new Error("Unsafe native query");
        if(nativeQueries===1)return {data:[]};
        return {data:Object.entries(input.params).filter(([key])=>key.startsWith("ray")).map(([,ray])=>nativeRows.get(ray))};
      }
    }
    export class Broker extends WorkerEntrypoint {
      journal(){return {previous:[{version:baseline,percentage:100}],deployment:{id:"restored"}}}
      begin(){if(${JSON.stringify(scenario)}==="claim-failure")throw new Error("Claim unavailable");return this.journal()}renew(){return this.journal()}
      promote(owner,value){phase=value;promotions.push(value);return this.journal()}
      rollback(){phase=0;restores++;return this.journal()}
    }
    globalThis.fetch=async(url,init)=>{
      const target=String(url);const req=new Request(url,init);
      if(req.redirect!=="manual")throw new Error("Unsafe redirect");
      if(target.startsWith("https://effect-ci-hmd-demo")) {
        const native=${JSON.stringify(scenario)}==="native-reject";
        const isBaseline=native?phase===0:new URL(target).searchParams.get("probe").includes("baseline");
        const healthy=isBaseline||!["force-regression","native-reject"].includes(${JSON.stringify(scenario)});
        const version=isBaseline?baseline:candidate;
        const ray=(++nativeRequests).toString(16).padStart(16,"0");
        nativeRows.set(ray,{timestamp:Date.now(),scriptName:"effect-ci-hmd-demo",logType:"cf-worker-event",requestId:"event-"+ray,rayId:ray,sampleInterval:1,
          attributes:{"$workers.eventType":"fetch","$workers.executionModel":"stateless","$workers.truncated":false,
            "$workers.scriptVersion.id":version,"$workers.outcome":"ok","$workers.event.request.method":"GET",
            "$workers.event.request.url":"https://effect-ci-hmd-demo.eclemmons.workers.dev/health","$workers.event.response.status":healthy?200:503}});
        return Response.json({version,healthy},{status:healthy?200:503,headers:{"cf-ray":ray+"-IAD"}});
      }
      if(target.startsWith("https://files.slack.com")) {
        const png=new Uint8Array(await req.arrayBuffer());if(png.length<1000||req.headers.has("authorization"))throw new Error("Invalid private PNG");
        return new Response("OK");
      }
      if(!target.startsWith("https://slack.com/api/"))throw new Error("Unexpected outbound URL");
      if(target.endsWith("files.getUploadURLExternal")){files++;return Response.json({ok:true,file_id:"F"+files,upload_url:"https://files.slack.com/upload/v1/"+files})}
      const body=await req.json();
      if(target.endsWith("files.completeUploadExternal")){if(body.channel_id)throw new Error("Public file share");return Response.json({ok:true,files:[{id:body.files[0].id,is_public:false}]})}
      if(target.endsWith("views.open")){modal=body.view;return Response.json({ok:true})}
      let messageTs="1791685465.683799";
      if(target.endsWith("chat.postMessage")){
        if(body.thread_ts){
          if(body.thread_ts!==messageTs||body.reply_broadcast!==false)throw new Error("Wrong parent or broadcast");
          messageTs="1791685465."+(700000+(++threadPosts));replyIds.add(messageTs);
        }else posts++;
      }else if(target.endsWith("chat.update")){
        if(body.ts!==messageTs){if(!replyIds.has(body.ts))throw new Error("Wrong message");messageTs=body.ts}else updates++;
        if(${JSON.stringify(scenario)}==="delivery-unavailable"&&body.ts==="1791685465.683799")return new Response("private upstream payload",{status:503});
        if(${JSON.stringify(scenario)}==="delivery-identity"&&body.ts==="1791685465.683799")return Response.json({ok:true,channel:"OTHER",ts:body.ts});
        if(${JSON.stringify(scenario)}==="approve"&&body.blocks.some(b=>b.type==="image")&&validationRejects<2){validationRejects++;return Response.json({ok:false,error:"invalid_blocks"})}
      }
      else throw new Error("Unexpected Slack method");
      (messageTs==="1791685465.683799"?frames:threadFrames).push(body);return Response.json({ok:true,channel:"C1",ts:messageTs});
    };
    export default class Driver extends WorkerEntrypoint {
      async fetch(req){
        const path=new URL(req.url).pathname;const workflow=this.ctx.exports.HmdReviewWorkflow;
        if(path==="/refresh-fence"){
          const reviews=this.ctx.exports.HmdApprovals.getByName("refresh-fixture"),owner="refresh-fixture",deadline=Date.now()+10000;
          const first=await reviews.register(owner,10,"a".repeat(64),deadline,0);
          const fenced=await reviews.refresh(owner,10,first.snapshot);
          const next=await reviews.register(owner,10,"b".repeat(64),deadline,1);
          const oldRejected=!await reviews.submit(first,"approved","Stale automated fixture","slack:T1:U1");
          const newReady=await reviews.inspect(next);
          await reviews.submit(next,"rejected","Pending automated rejection","slack:T1:U1");
          const pendingPreserved=!await reviews.refresh(owner,10,next.snapshot);
          let replacementRejected=false;
          try{await reviews.register(owner,10,"c".repeat(64),deadline,2)}catch{replacementRejected=true}
          return Response.json({fenced,oldRejected,newReady,pendingPreserved,replacementRejected});
        }
        if(path==="/deadline-fence"){
          fenceNow=wallNow();
          try{
          const idle=this.ctx.exports.HmdApprovals.getByName("deadline-idle");
          const consumed=this.ctx.exports.HmdApprovals.getByName("deadline-consumed");
          const digest="b".repeat(64),deadline=Date.now()+300;
          const first=await idle.register("deadline-idle",10,digest,deadline);
          // Simulate CI scheduling taking longer than the logical 300ms window.
          // Registration must not depend on host scheduling while testing fences.
          await new Promise(resolve=>setTimeout(resolve,350));
          const second=await consumed.register("deadline-consumed",10,digest,deadline);
          let earlyRejected=false,consumedRejected=false;
          try{await idle.expire(first.owner,10,digest)}catch{earlyRejected=true}
          await consumed.submit(second,"rejected","Automated unresolved rejection fixture","slack:T1:U1");
          fenceNow=deadline;
          await idle.expire(first.owner,10,digest);
          try{await consumed.expire(second.owner,10,digest)}catch{consumedRejected=true}
          return Response.json({earlyRejected,consumedRejected,closed:!await idle.inspect(first)});
          }finally{fenceNow=null}
        }
        if(path==="/start"){await workflow.create({id:"local-hmd",params:{intent:"hmd-review-lab",revision:"a".repeat(40),...(${JSON.stringify(scenario)}==="native-reject"?{telemetry:"experimental-native-wobs"}:{})}});return Response.json({started:true})}
        if(path==="/callback")return hmdSlackInteraction(req,this.env,{
          inspect:cap=>this.ctx.exports.HmdApprovals.getByName(cap.owner).inspect(cap),
          submit:(cap,decision,reason,actor)=>this.ctx.exports.HmdApprovals.getByName(cap.owner).submit(cap,decision,reason,actor)
        });
        const instance=await workflow.get("local-hmd");
        return Response.json({status:await instance.status(),phase,files,posts,updates,threadPosts,threadFrames,restores,promotions,frames,modal,validationRejects,nativeQueries,nativeRequests,deadlineExpirations});
      }
    }
  `, resolveDir: new URL(".", import.meta.url).pathname, sourcefile: "native-hmd-probe.ts", loader: "ts" },
    bundle: true, write: false, format: "esm", target: "esnext", external: ["cloudflare:workers", "cloudflare:workflows"],
    plugins: [{ name: "bundled-health-assets", setup(b: { onResolve: Function }) {
      b.onResolve({ filter: /index_bg\.wasm$/ }, () => ({ path: "./chart.wasm", external: true }))
      b.onResolve({ filter: /ABeeZee-Regular\.ttf\.bin$/ }, () => ({ path: "./font.bin", external: true }))
    } }],
  })
  const name = "hosted-hmd-native-probe"
  const json = (value: string) => ({ type: "json", value })
  const runtime = new Miniflare({ workers: [{ config: { name, compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: output.outputFiles[0].text },
      "chart.wasm": { type: "wasm", contents: new Uint8Array(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm"))) },
      "font.bin": { type: "data", contents: new Uint8Array(await readFile(new URL("../../../packages/github-cloudflare/assets/ABeeZee-Regular.ttf.bin", import.meta.url))) },
    } },
    exports: { HmdReviewWorkflow: { type: "workflow", name: "local-hmd-review" }, HealthChartRenderer: { type: "worker" },
      Broker: { type: "worker" }, Analytics: { type: "worker" }, PrivateSlackImages: { type: "durable-object", storage: "sqlite" },
      PrivateSlackCards: { type: "durable-object", storage: "sqlite" }, HmdApprovals: { type: "durable-object", storage: "sqlite" } },
    env: { RELEASE_MANAGER: { type: "worker", worker: name, exportName: "Broker" }, ANALYTICS_SQL: { type: "worker", worker: name, exportName: "Analytics" }, SLACK_BOT_TOKEN: json("test-token"),
      SLACK_APP_ID: json("A1"), SLACK_TEAM_ID: json("T1"), SLACK_CHANNEL_ID: json("C1"), SLACK_SIGNING_SECRET: json("test-secret"), SLACK_APPROVER_IDS: json("U1"),
      HMD_AUTO_PROGRESS_MINUTES: json(["deadline", "delivery-unavailable"].includes(scenario) ? "1" : "2") },
  } }] })
  const state = async () => (await runtime.dispatchFetch("https://probe.invalid/state")).json()
  const wait = async (predicate: (s: any) => boolean) => {
    for (let i = 0; i < (["deadline", "native-reject", "delivery-unavailable"].includes(scenario) ? 1500 : 200); i++) {
      const current = await state()
      if (predicate(current)) return current
      assert.notEqual(current.status.status, "errored", JSON.stringify({ error: current.status.error,
        waitErrors: current.status.__LOCAL_DEV_STEP_OUTPUTS?.filter((o: any) => o?.waitError) }))
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.fail("Native fixture did not reach the expected state")
  }
  const callback = async (payload: unknown) => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString()
    const signature = `v0=${createHmac("sha256", "test-secret").update(`v0:${timestamp}:${body}`).digest("hex")}`
    const response = await runtime.dispatchFetch("https://probe.invalid/callback", { method: "POST", body,
      headers: { "x-slack-request-timestamp": timestamp, "x-slack-signature": signature } })
    assert.equal(response.status, 200, await response.clone().text())
  }
  try {
    if (scenario === "approve") {
      assert.deepEqual(await (await runtime.dispatchFetch("https://probe.invalid/refresh-fence")).json(),
        {fenced:true,oldRejected:true,newReady:true,pendingPreserved:true,replacementRejected:true}, "native refresh invalidates stale buttons but never replaces a consumed rejection")
      const fenceResponse = await runtime.dispatchFetch("https://probe.invalid/deadline-fence")
      assert.equal(fenceResponse.status, 200, await fenceResponse.clone().text())
      const fence = await fenceResponse.json()
      assert.deepEqual(fence, { earlyRejected: true, consumedRejected: true, closed: true }, "native SQLite deadline fences pending decisions without bypassing consumed Reject")
    }
    const started = Date.now()
    assert.equal((await runtime.dispatchFetch("https://probe.invalid/start")).status, 200)
    if (scenario === "delivery-identity") {
      const failed = await wait((s) => s.status.status === "errored")
      assert.equal(failed.restores, 1); assert.deepEqual(failed.promotions, [10]); assert.equal(failed.phase, 0)
      // Miniflare promotes a non-retryable checkpoint exception to this generic
      // terminal error. Do not pretend its top-level message retains the cause.
      assert.equal(failed.status.error.name, "WorkflowFatalError")
      assert.match(failed.status.error.message, /NonRetryableError/)
      assert.equal(failed.posts, 1); assert.equal(failed.updates, 1)
      assert.ok(Date.now() - started < 45_000, "wrong owned identity must fail before the two-minute review wait")
      return
    }
    if (scenario === "delivery-unavailable") {
      const failed = await wait((s) => s.status.status === "errored")
      assert.ok(Date.now() - started >= 55_000, "presentation outage cannot initiate immediate rollback; actual configured wait must elapse")
      assert.equal(failed.posts, 1); assert.equal(failed.updates, 1, "pending acknowledgement prevents another update or post")
      assert.equal(failed.threadPosts, 1, "unavailable parent never creates orphan replies")
      assert.equal(failed.restores, 1); assert.deepEqual(failed.promotions, [10]); assert.equal(failed.phase, 0)
      assert.equal(failed.deadlineExpirations, 1, "actual SQLite deadline fence completed before restoration")
      assert.equal(failed.status.error.name, "WorkflowFatalError")
      assert.match(failed.status.error.message, /NonRetryableError/)
      const outputs = failed.status.__LOCAL_DEV_STEP_OUTPUTS
      assert.ok(outputs.some((o: any) => o?.status === "unavailable" && o.failure === "delivery-unavailable"))
      assert.ok(outputs.some((o: any) => o?.status === "unavailable" && o.failure === "delivery-pending"))
      assert.ok(!JSON.stringify(outputs).includes("private upstream payload")); assert.ok(!JSON.stringify(outputs).includes("test-token"))
      return
    }
    if (scenario === "claim-failure") {
      const failed = await wait((s) => s.status.status === "errored")
      assert.equal(failed.posts, 1)
      assert.equal(failed.updates, 1)
      assert.equal(failed.files, 0)
      assert.equal(failed.restores, 0, "unclaimed authority never rolls back another owner")
      assert.deepEqual(failed.promotions, [])
      assert.match(failed.frames.at(-1).text, /Failed/)
      assert.ok(!failed.frames.at(-1).text.includes("queued"), "terminated release has no pending steps")
      return
    }
    for (const phase of [10, 25, 75, 100]) {
      if (scenario === "deadline" && phase === 10) {
        // Actual local wait elapsed with no scripted decision. Never treat a
        // native timeout as independent review or advance into the next phase.
        break
      }
      const current = await wait((s) => s.phase === phase && s.frames.at(-1)?.blocks.some((b: any) => b.elements?.some((a: any) => a.action_id === "hmd_approve")))
      assert.doesNotMatch(JSON.stringify(current.frames), /Auto-progress at/)
      assert.match(JSON.stringify(current.threadFrames), /Progress explicitly accepts risk; otherwise restore at/)
      const action = current.frames.at(-1).blocks.flatMap((b: any) => b.elements ?? []).find((a: any) => a.action_id === (["reject", "deadline", "native-reject"].includes(scenario) ? "hmd_reject" : "hmd_approve"))
      const capability = JSON.parse(action.value)
      assert.equal(capability.phase, phase)
      if (!["reject", "deadline", "native-reject"].includes(scenario)) assert.equal(action.text.text, "Progress")
      await callback({ type: "block_actions", api_app_id: "A1", team: { id: "T1" }, user: { id: "U1" }, channel: { id: "C1" }, trigger_id: "test-trigger", actions: [action] })
      const opened = await state()
      assert.equal(opened.modal, null, "default direct decision has no comment modal")
      if (["reject", "deadline", "native-reject"].includes(scenario)) break
    }
    if (["reject", "deadline", "native-reject"].includes(scenario)) {
      const failed = await wait((s) => s.status.status === "errored")
      assert.equal(failed.posts, 1)
      assert.ok(failed.updates >= 2, "root exposes the decision and terminal outcome; identical frames may be suppressed")
      assert.equal(failed.files, 0, "default status does not render or upload a graph")
      assert.equal(failed.restores, 1)
      assert.equal(failed.phase, 0)
      assert.deepEqual(failed.promotions, [10], "deadline and rejection both stop further progression")
      if (scenario === "native-reject") {
        assert.equal(failed.nativeQueries, 3, "delayed baseline ingestion re-reads the same receipts before candidate query")
        assert.equal(failed.nativeRequests, 200, "ingestion wait did not generate replacement traffic")
        assert.ok(JSON.stringify(failed.threadFrames.at(-1)).includes("Native outcomes demo (experimental)"))
        assert.ok(!JSON.stringify(failed.threadFrames.at(-1)).includes("HTTP cohort"))
      }
      assert.match(failed.frames.at(-1).text, /↩️ Rolled back/)
      assert.match(failed.threadFrames.at(-1).text, /↩️ Restore previous version/)
      assert.match(failed.threadFrames.at(-1).text, /10% — failed/)
      assert.ok(!failed.frames.at(-1).text.includes("25%"))
      assert.ok(!JSON.stringify(failed.frames.at(-1)).includes("skipped"), "reverted card omits unexecuted stages")
      assert.match(failed.threadFrames.at(-1).text, /Restore previous version/)
      assert.match(failed.threadFrames.at(-1).text, scenario === "deadline" ? /> (Health review expired|Release operation failed; see Details\.)/ : /> Human rejected the release/)
      assert.ok(failed.threadPosts <= 4, "sampling edits bounded stage replies rather than posting repeatedly")
      assert.equal(failed.frames.at(-1).blocks.length, 2, "terminal root is title and identity only")
      assert.ok(!failed.frames.at(-1).text.includes("queued"), "future phases cannot remain queued after rejection")
      assert.ok(!failed.frames.at(-1).blocks.some((b: any) => b.elements?.some((a: any) => a.action_id === "hmd_approve")))
      return
    }
    const done = await wait((s) => s.status.status === "complete")
    assert.equal(done.posts, 1)
    assert.ok(done.updates >= 9)
    assert.equal(done.validationRejects, 0)
    assert.equal(done.files, 0)
    assert.equal(done.threadPosts, 6, "one prepare, four stage replies, and one restoration reply")
    assert.equal(done.restores, 1)
    assert.match(done.frames.at(-1).text, /↩️ Previous version restored/)
    assert.match(done.threadFrames.at(-1).text, /↩️ Restore previous version/)
    assert.equal(done.phase, 0)
    assert.ok(done.threadFrames.at(-1).text.includes("10% — approved"))
    assert.ok(!done.frames.at(-1).text.includes("warning"), "approval is not a warning state")
    assert.ok(done.frames.slice(1).every((frame: any) => frame.ts === "1791685465.683799"))
    const evidence = scenario === "force-regression" ? "regression" : "uncertain"
    assert.ok(done.frames.filter((frame: any) => frame.blocks.some((b: any) => b.type === "image")).every((frame: any) => frame.text.includes(evidence)))
    assert.ok(done.threadFrames.at(-1).text.includes(evidence))
    assert.ok(done.frames.every((frame:any)=>!frame.blocks.some((block:any)=>block.type==="image")))
    assert.equal(done.frames.at(-1).blocks.length, 2)
    assert.equal(done.status.output.releaseCommitted, false)
    assert.equal(done.status.output.wobsVerified, false)
  } finally { await runtime.dispose() }
})
}
