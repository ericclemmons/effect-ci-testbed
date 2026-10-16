import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { publicProposalFixture } from "../../../packages/github/src/public-proposal.fixture.ts";
import { publicProposalFromHistory } from "../../../packages/github/src/public-proposal.ts";
import { publicRepairRun } from "../../../packages/github/src/public-repair.ts";

test("local public Workflow keeps one Slack card and proposes only after verification; failed verification never proposes", { timeout: 60000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const f = await publicProposalFixture();
  const e = await publicProposalFromHistory(f.view.instance, { status: "complete", output: f.output }, f.view, f.after);
  const runId = publicRepairRun(e), candidate = "c".repeat(40);
  const { createHash } = await import("node:crypto");
  const actualDigest = createHash("sha256").update("export function healthStatus() { return 200; }\n").digest("hex");
  const compiled = await build({ stdin: { resolveDir: fileURLToPath(new URL(".", import.meta.url)), contents: `
    import {WorkerEntrypoint} from 'cloudflare:workers';
    export {PublicIncidentRepairOperations,PublicIncidentDispatcher,PublicIncidentRepairWorkflow,PublicPipelineReadiness} from './public-incident-repair.ts';
    export {PrivateSlackCards} from './private-cards.ts';
    globalThis.localPublicMessages=[];globalThis.localPublicVerified=0;globalThis.localPublicProposed=0;
    globalThis.fetch=async(url,init)=>{if(!String(url).startsWith('https://slack.com/api/'))throw Error('Unexpected LOCAL network');
      const body=JSON.parse(init.body);globalThis.localPublicMessages.push({url:String(url),body});
      return Response.json({ok:true,channel:'CLOCAL',ts:'1792080000.123456'});};
    export class RepairVerifier extends WorkerEntrypoint {verify(commit,run){
      if(commit!==${JSON.stringify(candidate)}||run!==${JSON.stringify(runId)})throw Error('Foreign verifier input');
      globalThis.localPublicVerified++;return {commit,sourceDigest:${JSON.stringify(actualDigest)},passed:this.env.FAIL_VERIFY!=='yes',evidenceId:'github_check_123'};}}
    export default class extends WorkerEntrypoint {async fetch(request){const path=new URL(request.url).pathname;
      if(path==='/ready'||path==='/wrong-ready'){try{const r=await this.ctx.exports.PublicPipelineReadiness({}).checkPublicPipeline(path==='/ready'?${JSON.stringify(f.view.admission.version)}:'22222222-2222-2222-2222-222222222222');return Response.json({ready:r.ready,version:r.version,source:r.source,fixtureDigest:r.fixtureDigest,budgetGuarded:r.budgetGuarded});}catch{return new Response('Not ready',{status:409});}}
      if(path==='/unsupported'){try{await this.ctx.exports.PublicIncidentDispatcher({}).trigger({type:'push',admissionId:${JSON.stringify(f.view.instance)}});return new Response('unexpected',{status:500});}catch{return new Response('Rejected',{status:400});}}
      if(path==='/unadmitted'){try{await this.ctx.exports.PublicIncidentDispatcher({}).trigger({type:'observability_issue',admissionId:'public-incident-'+ 'f'.repeat(64)});return new Response('unexpected',{status:500});}catch{return new Response('Rejected',{status:400});}}
      if(path==='/start'){const r=await this.ctx.exports.PublicIncidentDispatcher({}).trigger({type:'observability_issue',admissionId:${JSON.stringify(f.view.instance)}});return Response.json({id:r.id});}
      if(path==='/status')return Response.json(await(await this.ctx.exports.PublicIncidentRepairWorkflow.get(${JSON.stringify(f.view.instance)})).status());
      if(path==='/replay'){try{const r=await this.ctx.exports.PublicIncidentRepairOperations.getByName('owned-public-http-repair-v1').propose(${JSON.stringify(f.view.instance)});return Response.json({replay:r.replay,url:r.url});}catch{return new Response('Rejected',{status:400});}}
      return Response.json({messages:globalThis.localPublicMessages,verified:globalThis.localPublicVerified,proposed:globalThis.localPublicProposed,model:await this.env.PUBLIC_PROPOSAL.stats()});
    }}
  ` }, bundle: true, write: false, format: "esm", platform: "neutral", conditions: ["workerd", "import"], external: ["cloudflare:workers", "cloudflare:workflows", "node:*"],
    plugins: [{ name: "LOCAL-proposal-callback-only", setup(builder: any) {
      builder.onResolve({ filter: /\/repair\.ts$/ }, (args: any) => args.importer.endsWith("/apps/effect-ci/src/public-incident-repair.ts")
        ? { path: "local-propose", namespace: "local-propose" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "local-propose" }, () => ({ loader: "js", contents: `
        export async function proposeRepair(credentials,options,verify){
          if(credentials.appId!=='5089816'||options.runId!==${JSON.stringify(runId)}||options.proposedText!==${JSON.stringify(e.text)})throw Error('Foreign LOCAL proposal');
          const checked=await verify({commit:${JSON.stringify(candidate)}});
          if(checked.passed!==true||checked.commit!==${JSON.stringify(candidate)}||globalThis.localPublicVerified!==1)throw Error('No verified proposal');
          globalThis.localPublicProposed++;return {repository:'ericclemmons/effect-ci-private-github-fixture',commit:${JSON.stringify(candidate)},sourceDigest:${JSON.stringify(actualDigest)},evidenceId:'github_check_123',pullRequest:4,url:'https://github.com/ericclemmons/effect-ci-private-github-fixture/pull/4',created:true,deploymentPerformed:false};
        }` }));
    } }],
  });
  const fake = `import {WorkerEntrypoint} from 'cloudflare:workers';let starts=0,reads=0;
    export default class extends WorkerEntrypoint {
      readPublicAdmission(id){if(this.env.GITHUB_PRIVATE_KEY)throw Error('Credential leaked');if(id!==${JSON.stringify(f.view.instance)})throw Error('Foreign admission');return ${JSON.stringify(f.view)};}
      publicEnrollmentReadiness(version){if(version!==${JSON.stringify(f.view.admission.version)})throw Error('Foreign source version');return ${JSON.stringify(f.view.admission)};}
      publicActivationState(){return {state:'absent'};}
      publicProposalReadiness(){return {ready:true,run:'friday-flue-proposal-v1',reservedCents:50};}
      startPublicProposal(id){if(id!==${JSON.stringify(f.view.instance)})throw Error('Foreign start');starts++;return {id};}
      publicProposalStatus(){return {status:'complete'};}
      readPublicProposal(id){if(id!==${JSON.stringify(f.view.instance)})throw Error('Foreign read');reads++;return ${JSON.stringify(e)};}
      stats(){return {starts,reads};}
    }`;
  const helper = { name: "local-public-proposal", compatibilityDate: "2026-10-07",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: fake } } } };
  for (const fail of [false, true]) {
    const config = { name: "local-public-repair", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
      exports: { PublicIncidentRepairOperations: { type: "durable-object", storage: "sqlite" }, PublicIncidentDispatcher: { type: "worker" }, PublicPipelineReadiness: { type: "worker" },
        PublicIncidentRepairWorkflow: { type: "workflow", name: "local-public-repair" }, RepairVerifier: { type: "worker" }, PrivateSlackCards: { type: "durable-object", storage: "sqlite" } },
      env: { GITHUB_APP_ID: { type: "text", value: "5089816" }, GITHUB_PRIVATE_KEY: { type: "text", value: "LOCAL-fake-key" }, FAIL_VERIFY: { type: "text", value: fail ? "yes" : "no" },
        SLACK_APP_ID: { type: "text", value: "ALOCAL" }, SLACK_TEAM_ID: { type: "text", value: "TLOCAL" }, SLACK_CHANNEL_ID: { type: "text", value: "CLOCAL" }, SLACK_BOT_TOKEN: { type: "text", value: "LOCAL-fake-slack-token" },
        PUBLIC_ADMISSION: { type: "worker", worker: "local-public-proposal" }, PUBLIC_PROPOSAL: { type: "worker", worker: "local-public-proposal" } },
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: compiled.outputFiles[0].text } } } };
    const runtime = new Miniflare({ workers: [{ config }, { config: helper }] });
    try {
      const call = (path: string) => runtime.dispatchFetch(`https://local.invalid${path}`);
      const readiness = await (await call("/ready")).json();
      assert.equal(readiness.ready, true); assert.equal(readiness.version, f.view.admission.version);
      assert.equal((await call("/wrong-ready")).status, 409);
      assert.equal((await call("/unsupported")).status, 400);
      assert.equal((await call("/unadmitted")).status, 400);
      assert.equal((await call("/start")).status, 200);
      let terminal: any;
      for (let i = 0; i < 200; i++) {
        terminal = await (await call("/status")).json();
        if (["complete", "errored"].includes(terminal.status)) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(terminal.status, fail ? "errored" : "complete");
      const stats = await (await call("/stats")).json();
      assert.equal(stats.verified, 1); assert.equal(stats.proposed, fail ? 0 : 1);
      assert.equal(stats.model.starts, 1); assert.equal(stats.model.reads, 1);
      assert.equal(stats.messages.filter((m: any) => m.url.endsWith("chat.postMessage")).length, 1);
      assert.equal(stats.messages.filter((m: any) => m.url.endsWith("chat.update")).length, 2);
      assert.ok(stats.messages.slice(1).every((m: any) => m.body.ts === "1792080000.123456"));
      const replay = await call("/replay");
      assert.equal(replay.status, fail ? 400 : 200);
      const after = await (await call("/stats")).json();
      assert.equal(after.model.reads, 1); assert.equal(after.proposed, stats.proposed);
      assert.equal((await call("/ready")).status, 409, "a used writer slot must prevent another arm");
      if (!fail) { assert.equal(terminal.output.deploymentPerformed, false); assert.equal(terminal.output.slackTs, "1792080000.123456"); }
    } finally { await runtime.dispose(); }
  }
});
