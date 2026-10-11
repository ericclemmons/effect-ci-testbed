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
for (const scenario of ["approve", "force-regression", "deadline", "reject", "claim-failure"] as const) {
test(`native hosted HMD composition keeps one card: ${scenario}`, { timeout: 90_000 }, async () => {
  const output = await build({ stdin: { contents: `
    import {WorkerEntrypoint} from "cloudflare:workers";
    import {hmdSlackInteraction} from "./hmd-slack.ts";
    export {HmdReviewWorkflow} from "./hmd-workflow.ts";
    export {HealthChartRenderer} from "./health-renderer.ts";
    export {PrivateSlackImages} from "./private-images.ts";
    export {PrivateSlackCards} from "./private-cards.ts";
    export {HmdApprovals} from "./hmd-approval.ts";
    const baseline="09593237-23b2-4873-bd04-88c8e8488840",candidate="c94cee12-0bf4-48fb-bb42-9235f7ab7a3c";
    let phase=0,files=0,posts=0,updates=0,restores=0,modal=null,validationRejects=0;
    const promotions=[],frames=[];
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
        const isBaseline=new URL(target).searchParams.get("probe").includes("baseline");
        const healthy=isBaseline||${JSON.stringify(scenario)}!=="force-regression";
        return Response.json({version:isBaseline?baseline:candidate,healthy},{status:healthy?200:503});
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
      if(target.endsWith("chat.postMessage"))posts++;else if(target.endsWith("chat.update")){
        updates++;if(body.ts!=="1791685465.683799")throw new Error("Wrong message");
        if(${JSON.stringify(scenario)}==="approve"&&body.blocks.some(b=>b.type==="image")&&validationRejects<2){validationRejects++;return Response.json({ok:false,error:"invalid_blocks"})}
      }
      else throw new Error("Unexpected Slack method");
      frames.push(body);return Response.json({ok:true,channel:"C1",ts:"1791685465.683799"});
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
          const idle=this.ctx.exports.HmdApprovals.getByName("deadline-idle");
          const consumed=this.ctx.exports.HmdApprovals.getByName("deadline-consumed");
          const digest="b".repeat(64),deadline=Date.now()+300;
          const first=await idle.register("deadline-idle",10,digest,deadline);
          const second=await consumed.register("deadline-consumed",10,digest,deadline);
          let earlyRejected=false,consumedRejected=false;
          try{await idle.expire(first.owner,10,digest)}catch{earlyRejected=true}
          await consumed.submit(second,"rejected","Automated unresolved rejection fixture","slack:T1:U1");
          await new Promise(resolve=>setTimeout(resolve,350));
          await idle.expire(first.owner,10,digest);
          try{await consumed.expire(second.owner,10,digest)}catch{consumedRejected=true}
          return Response.json({earlyRejected,consumedRejected,closed:!await idle.inspect(first)});
        }
        if(path==="/start"){await workflow.create({id:"local-hmd",params:{intent:"hmd-review-lab",revision:"a".repeat(40)}});return Response.json({started:true})}
        if(path==="/callback")return hmdSlackInteraction(req,this.env,{
          inspect:cap=>this.ctx.exports.HmdApprovals.getByName(cap.owner).inspect(cap),
          submit:(cap,decision,reason,actor)=>this.ctx.exports.HmdApprovals.getByName(cap.owner).submit(cap,decision,reason,actor)
        });
        const instance=await workflow.get("local-hmd");
        return Response.json({status:await instance.status(),phase,files,posts,updates,restores,promotions,frames,modal,validationRejects});
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
      Broker: { type: "worker" }, PrivateSlackImages: { type: "durable-object", storage: "sqlite" },
      PrivateSlackCards: { type: "durable-object", storage: "sqlite" }, HmdApprovals: { type: "durable-object", storage: "sqlite" } },
    env: { RELEASE_MANAGER: { type: "worker", worker: name, exportName: "Broker" }, SLACK_BOT_TOKEN: json("test-token"),
      SLACK_APP_ID: json("A1"), SLACK_TEAM_ID: json("T1"), SLACK_CHANNEL_ID: json("C1"), SLACK_SIGNING_SECRET: json("test-secret"), SLACK_APPROVER_IDS: json("U1"),
      HMD_AUTO_PROGRESS_MINUTES: json(scenario === "deadline" ? "1" : "2") },
  } }] })
  const state = async () => (await runtime.dispatchFetch("https://probe.invalid/state")).json()
  const wait = async (predicate: (s: any) => boolean) => {
    for (let i = 0; i < (scenario === "deadline" ? 1500 : 200); i++) {
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
      const fence = await (await runtime.dispatchFetch("https://probe.invalid/deadline-fence")).json()
      assert.deepEqual(fence, { earlyRejected: true, consumedRejected: true, closed: true }, "native SQLite deadline fences pending decisions without bypassing consumed Reject")
    }
    assert.equal((await runtime.dispatchFetch("https://probe.invalid/start")).status, 200)
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
        await wait((s) => s.phase === 25 && s.frames.at(-1)?.blocks.some((b: any) => b.elements?.some((a: any) => a.action_id === "hmd_approve")))
        continue
      }
      const current = await wait((s) => s.phase === phase && s.frames.at(-1)?.blocks.some((b: any) => b.elements?.some((a: any) => a.action_id === "hmd_approve")))
      const action = current.frames.at(-1).blocks.flatMap((b: any) => b.elements ?? []).find((a: any) => a.action_id === (scenario === "reject" || scenario === "deadline" ? "hmd_reject" : "hmd_approve"))
      const capability = JSON.parse(action.value)
      assert.equal(capability.phase, phase)
      if (scenario !== "reject" && scenario !== "deadline") assert.equal(action.text.text, "Progress")
      await callback({ type: "block_actions", api_app_id: "A1", team: { id: "T1" }, user: { id: "U1" }, channel: { id: "C1" }, trigger_id: "test-trigger", actions: [action] })
      const opened = await state()
      assert.equal(opened.modal, null, "default direct decision has no comment modal")
      if (scenario === "reject" || scenario === "deadline") break
    }
    if (scenario === "reject" || scenario === "deadline") {
      const failed = await wait((s) => s.status.status === "errored")
      assert.equal(failed.posts, 1)
      assert.ok(scenario === "deadline" ? failed.updates >= 5 : failed.updates === 2)
      assert.ok(scenario === "deadline" ? failed.files >= 3 : failed.files === 1)
      assert.equal(failed.restores, 1)
      assert.equal(failed.phase, 0)
      assert.deepEqual(failed.promotions, scenario === "deadline" ? [10, 10, 25] : [10], "deadline progresses once; rejection stops further progression")
      assert.match(failed.frames.at(-1).text, /Failed/)
      assert.match(failed.frames.at(-1).text, scenario === "deadline" ? /10%\n/ : /10% — failed/)
      assert.match(failed.frames.at(-1).text, scenario === "deadline" ? /25% — failed/ : /25% — skipped/)
      assert.ok(!failed.frames.at(-1).text.includes("queued"), "future phases cannot remain queued after rejection")
      assert.ok(!failed.frames.at(-1).blocks.some((b: any) => b.elements?.some((a: any) => a.action_id === "hmd_approve")))
      return
    }
    const done = await wait((s) => s.status.status === "complete")
    assert.equal(done.posts, 1)
    assert.equal(done.updates, scenario === "approve" ? 11 : 9)
    assert.equal(done.validationRejects, scenario === "approve" ? 2 : 0, "bounded validation retries stay within one native notification checkpoint")
    assert.equal(done.files, 4)
    assert.equal(done.restores, 1)
    assert.equal(done.phase, 0)
    assert.ok(done.frames.at(-1).text.includes("10% — approved"))
    assert.ok(!done.frames.at(-1).text.includes("warning"), "approval is not a warning state")
    assert.ok(done.frames.slice(1).every((frame: any) => frame.ts === "1791685465.683799"))
    const evidence = scenario === "force-regression" ? "regression" : "uncertain"
    assert.ok(done.frames.filter((frame: any) => frame.blocks.some((b: any) => b.type === "image")).every((frame: any) => frame.text.includes(evidence)))
    assert.ok(done.frames.at(-1).text.includes(evidence))
    assert.equal(done.status.output.releaseCommitted, false)
    assert.equal(done.status.output.wobsVerified, false)
  } finally { await runtime.dispose() }
})
}
