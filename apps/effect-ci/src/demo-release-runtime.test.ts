import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

test(
  "actual local build/finalizer/review SQLite/RPC composition commits one candidate after four fake human decisions",
  { timeout: 30000 },
  async () => {
    const require = createRequire(import.meta.url),
      plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
    const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
    const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
    const bundle = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        loader: "ts",
        contents: `
    import{DurableObject,WorkerEntrypoint}from'cloudflare:workers';
    import*as CI from'@effect-ci-testbed/ci';import{workflowEntrypoint}from'@effect-ci-testbed/github-cloudflare';
    import{finalizeDemoRelease}from'./demo-release.ts';export{HmdApprovals}from'./hmd-approval.ts';
    const previous='11111111-1111-4111-8111-111111111111',version='22222222-2222-4222-8222-222222222222';
    const receipt={revision:'a'.repeat(40),digest:'b'.repeat(64),moduleDigest:'c'.repeat(64),version,policy:'owned-vite-release-pointer-v1',script:'effect-ci-hmd-demo'};
    let messages=[],phase=0,commits=0,rollbacks=0,images=0,renders=0,requests=0,rejectedPhases=new Set(),threadCount=0,failObservationCase=false,failObservationNow=false,observationFailures=0,failedObservationTargets=[];
    let journal,reviewFailureCase='',reviewDeliveryFailures=0,deadlineWaits=0;const copy=()=>structuredClone(journal);
    export class Broker extends WorkerEntrypoint{
      prepareCandidate(){return receipt;}
      begin(owner,candidate){phase=0;journal={candidate,previous:[{version:previous,percentage:100}],status:'active',deployment:{id:'33333333-3333-4333-8333-333333333333',versions:[{version:previous,percentage:100}]}};return copy();}
      renew(){return copy();}
      promote(owner,p){phase=p;journal.deployment={id:'44444444-4444-4444-8444-'+String(p).padStart(12,'0'),versions:p===100?[{version,percentage:100}]:[{version:previous,percentage:100-p},{version,percentage:p}]};return copy();}
      complete(){commits++;journal.status='complete';return copy();}
      rollback(){rollbacks++;phase=0;journal.status='rolled-back';journal.deployment.versions=[{version:previous,percentage:100}];return copy();}
    }
    export class WorkspaceContainer extends DurableObject{}
    export class HealthChartRenderer extends WorkerEntrypoint{render(){renders++;return new Uint8Array([1,2]);}}
    export class PrivateSlackImages extends DurableObject{upload(){images++;return {ok:true,fileId:'F123'};}}
    globalThis.fetch=async(input,init)=>{
      const url=String(input);
      if(url.startsWith('https://slack.com/api/')){if(failObservationNow){observationFailures++;failedObservationTargets.push({method:url.split('/').at(-1),ts:JSON.parse(init.body).ts});throw Error('private-presentation-token');}const body=JSON.parse(init.body),button=body.blocks?.find(b=>b.type==='actions')?.elements?.find(e=>e.action_id==='hmd_approve'),p=button?JSON.parse(button.value).phase:0,rejected=p&&!rejectedPhases.has(p);messages.push({url,body,accepted:!rejected});if(rejected){rejectedPhases.add(p);return Response.json({ok:false,error:'invalid_blocks'});}return Response.json({ok:true,ts:body.ts||(body.thread_ts?'123.'+String(++threadCount).padStart(6,'0'):'123.456')});}
      if(url.startsWith('https://effect-ci-hmd-demo.ericclemmons.workers.dev/health?')){requests++;const i=Number(new URL(url).searchParams.get('probe').split('-').at(-1));return Response.json({version:i<phase?version:previous,healthy:true});}
      throw Error('Unexpected outbound request');
    };
    const normalFetch=globalThis.fetch;globalThis.fetch=async(input,init)=>{
      if(String(input).startsWith('https://slack.com/api/')&&reviewFailureCase&&JSON.parse(init.body).blocks?.some(b=>b.type==='actions')){
        reviewDeliveryFailures++;
        if(reviewFailureCase==='wrong-review-identity')return Response.json({ok:true,ts:'999.999'});
        throw Error('private-review-transport-token');
      }
      return normalFetch(input,init);
    };
    const build=CI.action('build',()=>function*(){return receipt;});
    // TEST ONLY clock: keep the real Workflow/RPC/approval composition, skip elapsed settling time.
    export const DemoCIWorkflow=workflowEntrypoint(CI.workflow('cf-ci-demo',function*(){return yield*build();}),{cache:false,slackLayout:'status-thread',finalize:ctx=>finalizeDemoRelease({...ctx,
      observe:async(key,presentation,thread)=>{failObservationNow=failObservationCase&&key==='settled-100';try{return await ctx.observe(key,presentation,thread);}finally{failObservationNow=false;}},
      step:{do:(...args)=>ctx.step.do(...args),waitForEvent:(...args)=>{if(reviewFailureCase){deadlineWaits++;if(args[1].timeout!=='5 minutes')throw Error('Changed review deadline');throw Error('TEST ONLY simulated review deadline; no human decision');}return ctx.step.waitForEvent(...args);},sleep:async(name,duration)=>{if(!name.startsWith('vite-release:settle-')||duration!=='2 minutes')throw Error('Unexpected test clock sleep');}}})});
    export default{async fetch(request,env,ctx){const p=await request.json();
      if(p.op==='start'){reviewFailureCase=['unavailable-review','wrong-review-identity'].includes(p.id)?p.id:'';reviewDeliveryFailures=deadlineWaits=0;messages=[];rejectedPhases=new Set();commits=rollbacks=images=renders=requests=threadCount=observationFailures=0;failedObservationTargets=[];failObservationCase=p.id==='accept-observation-failure';failObservationNow=false;await ctx.exports.DemoCIWorkflow.create({id:p.id,params:{trigger:'remote',repository:'https://github.com/owner/repo.git',revision:receipt.revision}});return Response.json({started:true});}
      if(p.op==='status')return Response.json(await(await ctx.exports.DemoCIWorkflow.get(p.id)).status());
      if(p.op==='submit'){const r=ctx.exports.HmdApprovals.getByName(p.cap.owner);return Response.json(await r.submit(p.cap,p.decision,'FAKE local test human decision','slack:T1:U1'));}
      return Response.json({messages,phase,commits,rollbacks,images,renders,requests,rejectedPhases:[...rejectedPhases],journal,observationFailures,failedObservationTargets,reviewDeliveryFailures,deadlineWaits});
    }};`,
      },
      bundle: true,
      write: false,
      format: "esm",
      target: "esnext",
      conditions: ["workerd", "import"],
      external: ["cloudflare:workers", "node:*"],
    });
    const runtime = new Miniflare({
      workers: [
        {
          config: {
            name: "demo-release-test",
            compatibilityDate: "2026-10-07",
            compatibilityFlags: ["nodejs_compat"],
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } },
            },
            exports: {
              DemoCIWorkflow: { type: "workflow", name: "demo-release-test" },
              Broker: { type: "worker" },
              HealthChartRenderer: { type: "worker" },
              WorkspaceContainer: { type: "durable-object", storage: "sqlite" },
              PrivateSlackImages: { type: "durable-object", storage: "sqlite" },
              HmdApprovals: { type: "durable-object", storage: "sqlite" },
            },
            env: {
              RELEASE_MANAGER: {
                type: "worker",
                worker: "demo-release-test",
                exportName: "Broker",
              },
              SLACK_BOT_TOKEN: { type: "text", value: "fake-token" },
              SLACK_APP_ID: { type: "text", value: "A1" },
              SLACK_TEAM_ID: { type: "text", value: "T1" },
              SLACK_CHANNEL_ID: { type: "text", value: "C1" },
            },
          },
        },
      ],
    });
    const call = async (p: unknown): Promise<any> =>
      (
        await runtime.dispatchFetch("https://test.invalid", {
          method: "POST",
          body: JSON.stringify(p),
        })
      ).json();
    async function reviewAt(phase: number) {
      for (let n = 0; n < 200; n++) {
        const state = await call({});
        const frame = state.messages.filter((m: any) => m.accepted).at(-1)?.body;
        const button = frame?.blocks
          ?.find((b: any) => b.type === "actions")
          ?.elements?.find((e: any) => e.action_id === "hmd_approve");
        if (button) {
          const cap = JSON.parse(button.value);
          if (cap.phase === phase) return cap;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      throw Error("No review " + phase);
    }
    async function terminal(id: string) {
      for (let n = 0; n < 200; n++) {
        const s = await call({ op: "status", id });
        if (["complete", "errored"].includes(s.status)) return s;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw Error("No terminal state");
    }
    try {
      for (const id of ["accept", "reject", "accept-observation-failure"]) {
        await call({ op: "start", id });
        for (const phase of [10, 25, 75, 100]) {
          const cap = await reviewAt(phase);
          assert.equal(
            await call({
              op: "submit",
              cap,
              decision: id === "reject" && phase === 25 ? "rejected" : "approved",
            }),
            true,
          );
          assert.equal(
            await call({ op: "submit", cap, decision: "approved" }),
            false,
            "consumed capability cannot replay",
          );
          if (id === "reject" && phase === 25) break;
        }
        const outcome = await terminal(id),
          state = await call({});
        assert.equal(
          outcome.status,
          id !== "reject" ? "complete" : "errored",
          JSON.stringify(outcome.error),
        );
        assert.equal(state.commits, id !== "reject" ? 1 : 0);
        assert.equal(state.rollbacks, id !== "reject" ? 0 : 1);
        assert.equal(state.journal.status, id !== "reject" ? "complete" : "rolled-back");
        assert.equal(state.observationFailures, id === "accept-observation-failure" ? 2 : 0,
          "one attempt each for the known parent and existing reply, not a repost");
        if (id === "accept-observation-failure") {
          assert.equal(new Set(state.failedObservationTargets.map((t: any) => t.ts)).size, 2);
          assert.ok(state.failedObservationTargets.every((t: any) => t.method === "chat.update" && typeof t.ts === "string"));
        }
        assert.ok(!JSON.stringify(outcome).includes("private-presentation-token"));
        assert.equal(
          state.messages.filter((m: any) => m.url.endsWith("/chat.postMessage") && !m.body.thread_ts).length,
          1,
        );
        assert.equal(state.images, id !== "reject" ? 4 : 2);
        assert.equal(state.renders, state.images);
        assert.equal(state.rejectedPhases.length, state.images, "each private image's definite validation rejection is bounded and recovered before review");
        assert.equal(state.requests, id !== "reject" ? 500 : 300);
        const roots = state.messages.filter((m: any) => !m.body.thread_ts && (!m.body.ts || m.body.ts === "123.456"));
        assert.ok(roots.every((m: any) => m.body.blocks[0].type === "section" && /cf-ci-demo/.test(m.body.text)));
        assert.ok(roots.every((m: any) => !/hmd_approve|1\\. |2\\. /.test(JSON.stringify(m.body.blocks))));
        assert.ok(roots.at(-1).body.blocks.some((b: any) => b.type === "image" && b.slack_file.id === "F123"), "terminal parent preserves latest graph");
        const replyUpdates = state.messages.filter((m: any) => m.body.ts && m.body.ts !== "123.456");
        assert.ok(replyUpdates.every((m: any) => !m.body.blocks.some((b: any) => ["header", "context", "divider"].includes(b.type))), "step replies omit repeated run chrome");
        const replies = state.messages.filter((m: any) => m.body.thread_ts);
        assert.equal(replies.length, 1 + state.images, "one build reply and one reply per reviewed phase");
        assert.ok(replies.every((m: any) => m.body.thread_ts === "123.456" && m.body.reply_broadcast === false));
        assert.ok(state.messages.some((m: any) => m.body.ts !== "123.456" && m.body.blocks.some((b: any) => b.type === "image")));
        assert.ok(!state.messages.at(-1).body.blocks.some((b: any) => b.type === "actions"));
      }
      for (const id of ["unavailable-review", "wrong-review-identity"]) {
        await call({ op: "start", id });
        const outcome = await terminal(id), state = await call({});
        assert.equal(outcome.status, "errored");
        assert.equal(state.reviewDeliveryFailures, 1, "no review repost or transport retry");
        assert.equal(state.deadlineWaits, id === "unavailable-review" ? 1 : 0,
          "transport outage retains the decision deadline; identity mismatch fails closed before waiting");
        assert.equal(state.commits, 0, "missing delivery/decision never authorizes acceptance");
        assert.equal(state.rollbacks, 1);
        assert.equal(state.journal.status, "rolled-back");
        assert.equal(state.messages.filter((m: any) => m.url.endsWith("/chat.postMessage") && !m.body.thread_ts).length, 1);
        assert.ok(!JSON.stringify(outcome).includes("private-review-transport-token"));
      }
    } finally {
      await runtime.dispose();
    }
  },
);
