import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { publicIncidentIdentity } from "../../../packages/github/src/public-incident.ts";
import { publicProposalFixture } from "../../../packages/github/src/public-proposal.fixture.ts";
import { publicProposalFromHistory } from "../../../packages/github/src/public-proposal.ts";
import { runPublicRepair } from "../../../packages/github/src/public-repair.ts";

test("real local reconciliation appends a receipt, preserves failed SQLite/history and only updates an existing card", { timeout: 60000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  // SYNTHETIC proposal/ledger on the fixed host-selected public admission. No live transports.
  const f = await publicProposalFixture();
  const view = await publicIncidentIdentity({ ...f.view.admission,
    issue: "52da6a3f-87f0-49cd-865d-c7d7030a169b", correlation: "d6ac2b53-0cea-42ae-8de7-2f001416ef2f",
    source: "f8eb61a874ccf972fceed25ed6889978608d87bc", version: "9c829b54-985d-4811-b806-690f93338284",
    emission: "owned-public-health-500-v2", claimedAt: 1792123841466, observedAt: 1792123841515 });
  const admitted = { instance: view.instance, admission: view.admission };
  const e = await publicProposalFromHistory(view.instance, { status: "complete", output: { ...f.output, admitted } }, admitted, f.after);
  let failed: any;
  await assert.rejects(runPublicRepair(e.instance, { read: async () => failed,
    claim: async r => { failed = structuredClone(r); return true; }, complete: async () => { throw Error("Must not complete"); },
    fail: async () => { failed.state = "failed"; } }, async () => e, async () => { throw Error("Synthetic final acknowledgement failure"); }));
  const commit = "390e1eb0fb1c29263a3ec329c6db9049b881c66a", evidenceId = "github_check_116806821705";
  const result = { repository: "ericclemmons/effect-ci-private-github-fixture", commit,
    sourceDigest: createHash("sha256").update("export function healthStatus() { return 200; }\n").digest("hex"),
    evidenceId, pullRequest: 4, url: "https://github.com/ericclemmons/effect-ci-private-github-fixture/pull/4", created: false, deploymentPerformed: false };
  const source = `
    import {WorkerEntrypoint,WorkflowEntrypoint} from 'cloudflare:workers';
    import {NonRetryableError} from 'cloudflare:workflows';
    import {PublicIncidentRepairOperations as Original} from './public-incident-repair.ts';
    export class PublicIncidentRepairOperations extends Original {
      async seed(){await this.ctx.storage.put('public-native-repair-v1',${JSON.stringify(failed)});}
      async receipts(){return {original:await this.ctx.storage.get('public-native-repair-v1'),reconciliation:await this.ctx.storage.get('public-native-repair-v1:reconciliation-v1')};}
    }
    export {OwnedRepairVerificationWorkflow} from './repair-verifier.ts';
    export {PrivateSlackCards} from './private-cards.ts';
    export class PublicIncidentRepairWorkflow extends WorkflowEntrypoint {async run(){throw new NonRetryableError('LOCAL original failure retained');}}
    globalThis.localMessages=[];globalThis.localReads=0;globalThis.localChecks=0;
    globalThis.fetch=async(url,init)=>{if(!String(url).startsWith('https://slack.com/api/'))throw Error('Unexpected LOCAL transport');
      const body=JSON.parse(init.body);globalThis.localMessages.push({url:String(url),body});return Response.json({ok:true,channel:'CLOCAL',ts:'1792080000.123456'});};
    export class Proposal extends WorkerEntrypoint {readPublicProposal(id){if(id!==${JSON.stringify(e.instance)})throw Error('Foreign admission');globalThis.localReads++;return ${JSON.stringify(e)};}}
    export default class extends WorkerEntrypoint {async fetch(request){const p=new URL(request.url).pathname;
      const op=this.ctx.exports.PublicIncidentRepairOperations.getByName('owned-public-http-repair-v1');
      if(p==='/seed'){await op.seed();if(this.env.ORPHAN!=='yes'){const r=await this.ctx.exports.PrivateSlackCards.getByName(${JSON.stringify(e.instance)}).publish(${JSON.stringify(e.instance)},3,{text:'stopped',blocks:[{type:'section',text:{type:'plain_text',text:'stopped'}}]});if(!r.ok)throw Error('LOCAL seed card unavailable');}
        await this.ctx.exports.PublicIncidentRepairWorkflow.create({id:${JSON.stringify(e.instance)},params:{}});return new Response('seeded');}
      if(p==='/original')return Response.json(await(await this.ctx.exports.PublicIncidentRepairWorkflow.get(${JSON.stringify(e.instance)})).status());
      if(p==='/start'){await this.ctx.exports.OwnedRepairVerificationWorkflow.create({id:'local-reconcile',params:{mode:'reconcile-public-pr'}});return new Response('started');}
      if(p==='/status')return Response.json(await(await this.ctx.exports.OwnedRepairVerificationWorkflow.get('local-reconcile')).status());
      const r=await op.receipts();return Response.json({original:r.original,reconciliation:r.reconciliation,messages:globalThis.localMessages,reads:globalThis.localReads,checks:globalThis.localChecks});
    }}
  `;
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL(".", import.meta.url)), contents: source, loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "neutral", conditions: ["workerd", "import"], external: ["cloudflare:workers", "cloudflare:workflows", "node:*"],
    plugins: [{ name: "LOCAL-read-only-transports", setup(b: any) {
      b.onResolve({ filter: /\/(repair|repair-verifier)\.ts$/ }, (a: any) => a.importer.endsWith("/apps/effect-ci/src/public-incident-repair.ts")
        ? { path: a.path, namespace: "local-reconcile" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "local-reconcile" }, (a: any) => ({ loader: "js", contents: a.path.endsWith("/repair.ts") ? `
        export function proposeRepair(){throw Error('Writer must not run');}
        export async function reconcileRepair(credentials,options,verify){if(credentials.appId!=='5089816'||options.runId!=='public-52da6a3f87f049cd865dc7d7030a169b')throw Error('Foreign LOCAL input');
          await verify({commit:${JSON.stringify(commit)}});return ${JSON.stringify(result)};}` : `
        export const OWNED_BASE='352327387f610d84282a567bf9a40ceee3978950';
        export async function readOwnedRepairVerification(credentials,commit,run,id){if(commit!==${JSON.stringify(commit)}||id!==${JSON.stringify(evidenceId)})throw Error('Foreign retained evidence');globalThis.localChecks++;return {commit,sourceDigest:${JSON.stringify(result.sourceDigest)},evidenceId:id,passed:true};}` }));
    } }],
  });
  for (const orphan of [false, true]) {
    const name = "local-reconciliation";
    const runtime = new Miniflare({ workers: [{ config: { name, compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
      exports: { PublicIncidentRepairOperations: { type: "durable-object", storage: "sqlite" }, PrivateSlackCards: { type: "durable-object", storage: "sqlite" },
        Proposal: { type: "worker" }, PublicIncidentRepairWorkflow: { type: "workflow", name: "local-original" }, OwnedRepairVerificationWorkflow: { type: "workflow", name: "local-reconcile" } },
      env: { GITHUB_APP_ID: { type: "text", value: "5089816" }, GITHUB_PRIVATE_KEY: { type: "text", value: "LOCAL-key" }, ORPHAN: { type: "text", value: orphan ? "yes" : "no" },
        SLACK_APP_ID: { type: "text", value: "ALOCAL" }, SLACK_TEAM_ID: { type: "text", value: "TLOCAL" }, SLACK_CHANNEL_ID: { type: "text", value: "CLOCAL" }, SLACK_BOT_TOKEN: { type: "text", value: "LOCAL-token" },
        PUBLIC_PROPOSAL: { type: "worker", worker: name, exportName: "Proposal" } },
    } }] });
    try {
      const call = (path: string) => runtime.dispatchFetch(`https://local.invalid${path}`);
      await call("/seed");
      const wait = async (path: string) => { for (let i = 0; i < 100; i++) { const h = await (await call(path)).json(); if (["complete", "errored"].includes(h.status)) return h; await new Promise(r => setTimeout(r, 10)); } throw Error("LOCAL Workflow did not finish"); };
      assert.equal((await wait("/original")).status, "errored");
      await call("/start");const h = await wait("/status");
      assert.equal(h.status, orphan ? "errored" : "complete", JSON.stringify(h));
      const r = await (await call("/inspect")).json();
      assert.deepEqual(r.original, failed);assert.equal(r.original.state, "failed");
      assert.equal(r.reconciliation.originalWorkflowStatus, "errored");assert.equal(r.reconciliation.created, false);
      assert.equal(r.reads, 1);assert.equal(r.checks, 1);
      assert.equal(r.messages.length, orphan ? 0 : 2);
      if (!orphan) { assert.ok(r.messages[1].url.endsWith('chat.update'));assert.equal(r.messages[1].body.ts,"1792080000.123456");assert.equal(h.output.slackTs,"1792080000.123456"); }
      assert.equal((await wait("/original")).status, "errored");
    } finally { await runtime.dispose(); }
  }
});
