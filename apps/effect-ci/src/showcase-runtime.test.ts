import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHmac, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { showcaseTestCommand } from "./showcase-check-policy.ts";

test("native showcase checkpoints authored actions, consumes the checked build and maintains its Slack card", { timeout: 30_000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const bundle = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
    import {demoSite,demoSiteUrl} from '@effect-ci-testbed/cloudflare/demo-site';
    import manifest from '../../../examples/demo/package.json';
    import {ShowcaseCIWorkflow as ActualShowcase} from './showcase-workflow.ts';
    import {hmdSlackInteraction} from './hmd-slack.ts';
    export {HmdApprovals} from './hmd-approval.ts';
    export {TrustedDemoChecks} from './trusted-demo-checks.ts';
    export class ShowcaseCIWorkflow extends ActualShowcase {
      async run(event,step){return super.run(event,{do:(...args)=>step.do(...args),waitForEvent:(...args)=>{
        if(mode==='deadline-10'&&args[0]==='demo-review:wait-10')throw Error('LOCAL TEST review deadline');return step.waitForEvent(...args)},
        sleep:async(name,duration)=>{if(!name.startsWith('vite-release:settle-')||duration!=='2 minutes')throw Error('Unexpected test clock sleep')}})}
    }
    const commands=[],messages=[],publications=[],reads=[],github=[];let published,thread=0,prepared=0,phase=0,journal,commits=0,rollbacks=0,stopped=0,mode='';
    const previous='11111111-1111-4111-8111-111111111111',version='22222222-2222-4222-8222-222222222222';
    const assets={'index.html':'<h1>The checked app</h1>','app.js':'export const app=1','message.js':'export const message="hello"'};
    export class Publisher extends WorkerEntrypoint {
      async publish(revision,files){publications.push({revision,files});published=await demoSite(revision,files);return{revision,digest:published.digest,url:demoSiteUrl(published)}}
    }
    export class Broker extends WorkerEntrypoint {
      prepareCandidate(revision,digest){prepared++;return{revision,digest,moduleDigest:'c'.repeat(64),version,policy:'owned-vite-release-pointer-v1',script:'effect-ci-hmd-demo'}}
      begin(owner,candidate){journal={candidate,previous:[{version:previous,percentage:100}],status:'active',deployment:{id:'33333333-3333-4333-8333-333333333333',versions:[{version:previous,percentage:100}]}};return structuredClone(journal)}
      renew(){return structuredClone(journal)}
      promote(owner,p){phase=p;journal.deployment={id:'44444444-4444-4444-8444-'+String(p).padStart(12,'0'),versions:p===100?[{version,percentage:100}]:[{version:previous,percentage:100-p},{version,percentage:p}]};return structuredClone(journal)}
      complete(){commits++;journal.status='complete';return structuredClone(journal)}
      rollback(){rollbacks++;phase=0;journal.status='rolled-back';journal.deployment.versions=[{version:previous,percentage:100}];return structuredClone(journal)}
    }
    export class HealthChartRenderer extends WorkerEntrypoint {render(){return new Uint8Array([1,2])}}
    export class PrivateSlackImages extends DurableObject {upload(){return{ok:true,fileId:'F123'}}}
    export class WorkspaceContainer extends DurableObject {
      stop(){stopped++}
      async checkout(){}
      async restore(){}
      async checkpoint(name){return{id:'snapshot-'+name,name,size:1}}
      async getCachedSnapshot(){throw Error('No whole-container cache is enrolled')}
      async putCachedSnapshot(){throw Error('No whole-container cache is enrolled')}
      async readFile(path,cwd,_step,revision){
        if(cwd!=='/workspace/repository/examples/demo')throw Error('Wrong app root');
        reads.push({path,snapshot:revision?.id});
        if(path==='package.json')return JSON.stringify(manifest);
        if(path.startsWith('dist/')){
          if(revision?.id!=='snapshot-build-workspace')throw Error('Publication did not consume the completed build');
          return assets[path.slice(5)];
        }
      }
      async exists(path,cwd){return path==='.'||path==='pnpm-lock.yaml'}
      async execute(command,cwd,step){
        if(cwd!=='/workspace/repository/examples/demo')throw Error('Wrong command root');
        commands.push({command,step});return{exitCode:0,stdout:'completed '+step,stderr:''};
      }
    }
    globalThis.fetch=async(input,init)=>{
      const url=new URL(String(input));
      if(url.hostname==='api.github.com'){
        if(url.pathname.endsWith('/access_tokens'))return Response.json({token:'fake-github-token'});
        const body=JSON.parse(init.body);github.push(body);return Response.json({id:1000+github.length,html_url:'https://github.com/example/check'});
      }
      if(url.hostname==='effect-ci-demo-site.ericclemmons.workers.dev'){
        const name=url.pathname.split('/').at(-1);
        return new Response(published.assets[name],{headers:{'x-site-revision':published.revision,'x-site-digest':published.digest}});
      }
      if(url.hostname==='slack.com'){
        if(url.pathname==='/api/chat.getPermalink')return Response.json({ok:true,channel:'C1',permalink:'https://fixture.slack.com/archives/C1/p'+url.searchParams.get('message_ts').replace('.','')});
        const body=JSON.parse(init.body);messages.push({path:url.pathname,body});
        return Response.json({ok:true,ts:body.ts||(body.thread_ts?'123.'+String(++thread).padStart(6,'0'):'123.456')});
      }
      if(url.hostname==='effect-ci-hmd-demo.ericclemmons.workers.dev'){
        const index=Number(url.searchParams.get('probe').split('-').at(-1));
        return Response.json({version:index<phase?version:previous,healthy:true});
      }
      throw Error('Unexpected external request');
    };
    export default{async fetch(request,env,ctx){
      if(new URL(request.url).pathname==='/webhooks/slack')return hmdSlackInteraction(request,env,{
        inspect:cap=>ctx.exports.HmdApprovals.getByName(cap.owner).inspect(cap),
        submit:(cap,decision,reason,actor)=>ctx.exports.HmdApprovals.getByName(cap.owner).submit(cap,decision,reason,actor),
      });
      const p=await request.json();
      if(p.op==='start'){commands.length=messages.length=publications.length=reads.length=github.length=0;thread=prepared=phase=commits=rollbacks=0;journal=undefined;mode=p.mode??'';
        await ctx.exports.ShowcaseCIWorkflow.create({id:p.id,params:{trigger:p.release?'github':'remote',repository:'https://github.com/ericclemmons/effect-ci-testbed.git',revision:'a'.repeat(40),
          ...(p.release?{repositoryName:'ericclemmons/effect-ci-testbed',installationId:165265172,deliveryId:p.id,summaryCheckId:999,ref:'refs/heads/demo/showcase'}:{}),
          ...(p.targets?{targets:p.targets}:{})}});return Response.json({started:true});}
      if(p.op==='status')return Response.json(await(await ctx.exports.ShowcaseCIWorkflow.get(p.id)).status());
      return Response.json({commands,messages,publications,reads,github,prepared,phase,commits,rollbacks,stopped,journal});
    }};` }, bundle: true, write: false, format: "esm", target: "esnext", platform: "neutral",
    conditions: ["workerd", "import"], external: ["cloudflare:workers", "node:*"],
  });
  const name = "showcase-native-test";
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const runtime = new Miniflare({ workers: [{ config: { name, compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
    exports: { ShowcaseCIWorkflow: { type: "workflow", name }, WorkspaceContainer: { type: "durable-object", storage: "sqlite" }, Publisher: { type: "worker" },
      TrustedDemoChecks: { type: "durable-object", storage: "sqlite" }, Broker: { type: "worker" }, HealthChartRenderer: { type: "worker" }, PrivateSlackImages: { type: "durable-object", storage: "sqlite" }, HmdApprovals: { type: "durable-object", storage: "sqlite" } },
    env: { VERSION_METADATA: { type: "json", value: { id: "11111111-1111-4111-8111-111111111111" } }, DEMO_SITE: { type: "worker", worker: name, exportName: "Publisher" },
      RELEASE_MANAGER: { type: "worker", worker: name, exportName: "Broker" },
      GITHUB_APP_ID: { type: "text", value: "5089816" }, GITHUB_PRIVATE_KEY: { type: "text", value: privateKey },
      SLACK_BOT_TOKEN: { type: "text", value: "fake-slack-token" }, SLACK_CHANNEL_ID: { type: "text", value: "C1" },
      SLACK_APP_ID: { type: "text", value: "A1" }, SLACK_TEAM_ID: { type: "text", value: "T1" },
      SLACK_SIGNING_SECRET: { type: "text", value: "local-test-signing-secret" }, SLACK_APPROVER_IDS: { type: "text", value: "U1" } },
  } }] });
  const call = async (body: unknown): Promise<any> => {
    const response = await runtime.dispatchFetch("https://test.invalid", { method: "POST", body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const click = async (capability: unknown, decision: string, options: { user?: string; timestamp?: string; secret?: string } = {}) => {
    const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
    const body = new URLSearchParams({ payload: JSON.stringify({ type: "block_actions", api_app_id: "A1", team: { id: "T1" },
      user: { id: options.user ?? "U1" }, channel: { id: "C1" }, trigger_id: "local-test-trigger",
      actions: [{ action_id: decision === "approved" ? "hmd_approve" : "hmd_reject", value: JSON.stringify(capability) }] }) }).toString();
    const signature = "v0=" + createHmac("sha256", options.secret ?? "local-test-signing-secret")
      .update(`v0:${timestamp}:${body}`).digest("hex");
    return runtime.dispatchFetch("https://test.invalid/webhooks/slack", { method: "POST", body,
      headers: { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": timestamp, "x-slack-signature": signature } });
  };
  const decide = async (capability: unknown, decision: string) => {
    const response = await click(capability, decision);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).text, "Decision recorded. The release card will update when the Workflow resumes.");
    const duplicate = await click(capability, decision);
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).text, "This phase is no longer awaiting review.");
  };
  try {
    for (const targets of [undefined, ["test"]]) {
      const id = targets ? "selected" : "preview";
      await call({ op: "start", id, targets });
      let result: any;
      for (let i = 0; i < 200; i++) {
        result = await call({ op: "status", id });
        assert.notEqual(result.status, "errored", JSON.stringify(result.error));
        if (result.status === "complete") break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(result.status, "complete");
      const state = await call({ op: "state" });
      assert.ok(state.stopped > 0, "finished showcase compute containers are stopped");
      assert.equal(state.commands.filter((c: any) => c.command.includes("install")).length, 1);
      assert.ok(state.commands.some((c: any) => c.command === showcaseTestCommand));
      assert.ok(result.output.nodes.some((n: any) => n.id === "test" && n.status === "complete"));
      assert.equal(state.publications.length, targets ? 0 : 1);
      assert.equal(state.messages.filter((m: any) => m.path.endsWith("chat.postMessage") && !m.body.thread_ts).length, 1);
      assert.ok(state.messages.some((m: any) => m.path.endsWith("chat.update")));
      assert.equal(state.messages.some((m: any) => JSON.stringify(m.body).includes("hmd_approve")), false,
        "remote CLI cannot arm or start a production rollout");
      if (!targets) {
        assert.ok(state.reads.filter((r: any) => r.path.startsWith("dist/")).every((r: any) => r.snapshot === "snapshot-build-workspace"));
        assert.ok(state.messages.some((m: any) => JSON.stringify(m.body).includes("checked preview") &&
          JSON.stringify(m.body).includes("https://effect-ci-demo-site.ericclemmons.workers.dev/r/")));
      }
    }
    await call({op:"start",id:"release-reject",release:true});
    let rejected=false,terminal:any;
    for(let i=0;i<300;i++){
      terminal=await call({op:"status",id:"release-reject"});
      const state=await call({op:"state"});
      const button=state.messages.flatMap((m:any)=>m.body.blocks??[]).filter((b:any)=>b.type==='actions').flatMap((b:any)=>b.elements).find((e:any)=>e.action_id==='hmd_approve');
      if(button&&!rejected){
        assert.ok(state.stopped > 0, "compute is stopped before waiting on a human");
        assert.equal(state.prepared,0);assert.equal(state.phase,0);
        const cap=JSON.parse(button.value);assert.equal(cap.phase,0);
        assert.equal((await click(cap,'approved',{secret:'wrong-test-secret'})).status,401);
        assert.equal((await click(cap,'approved',{timestamp:'1'})).status,401);
        assert.equal((await click(cap,'approved',{user:'U2'})).status,403);
        const stale=await click({...cap,snapshot:'f'.repeat(64)},'approved');
        assert.equal(stale.status,200);
        assert.equal((await stale.json()).text,'This phase is no longer awaiting review.');
        const stillWaiting=await call({op:'state'});
        assert.equal(stillWaiting.prepared,0);assert.equal(stillWaiting.phase,0);
        await decide(cap,'rejected');rejected=true;
      }
      if(terminal.status==='errored')break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(rejected,true);assert.equal(terminal.status,'errored');
    const state=await call({op:'state'});
    assert.equal(state.prepared,0);assert.equal(state.phase,0);assert.equal(state.commits,0);
    assert.equal(state.publications.length,1,"a human reviews the checked immutable preview, not an unbuilt promise");
    for(const mode of ['progress','reject-10','deadline-10']){
      const id='release-'+mode;
      await call({op:'start',id,release:true,mode});
      const consumed=new Set<string>(),phases:number[]=[];
      let terminal:any;
      for(let i=0;i<500;i++){
        terminal=await call({op:'status',id});
        const state=await call({op:'state'});
        const buttons=state.messages.flatMap((m:any)=>m.body.blocks??[]).filter((b:any)=>b.type==='actions').flatMap((b:any)=>b.elements).filter((e:any)=>e.action_id==='hmd_approve');
        for(const button of buttons){
          const cap=JSON.parse(button.value),key=cap.phase+':'+cap.snapshot;
          if(consumed.has(key)||mode==='deadline-10'&&cap.phase===10)continue;
          if(cap.phase===0){assert.equal(state.prepared,0);assert.equal(state.phase,0);}
          const decision=mode==='reject-10'&&cap.phase===10?'rejected':'approved';
          await decide(cap,decision);
          consumed.add(key);phases.push(cap.phase);
        }
        if(['complete','errored'].includes(terminal.status))break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      const state=await call({op:'state'});
      assert.equal(terminal.status,mode==='progress'?'complete':'errored',JSON.stringify({error:terminal.error,phases}));
      assert.deepEqual(phases,mode==='progress'?[0,10,25,75,100]:mode==='reject-10'?[0,10]:[0]);
      assert.equal(state.commits,mode==='progress'?1:0);
      assert.equal(state.rollbacks,mode==='progress'?0:1);
      assert.equal(state.publications.length,1);
      assert.deepEqual(state.journal.deployment.versions,[{version:mode==='progress'?'22222222-2222-4222-8222-222222222222':'11111111-1111-4111-8111-111111111111',percentage:100}]);
      assert.equal(state.messages.filter((m:any)=>m.path.endsWith('chat.postMessage')&&!m.body.thread_ts).length,1);
      assert.ok(state.github.some((g:any)=>g.name==='Rollout / conference demo'));
      assert.ok(state.messages.some((m:any)=>(m.body.blocks??[]).some((b:any)=>b.type==='image')),'the same review thread includes its health chart');
    }
  } finally { await runtime.dispose(); }
});
