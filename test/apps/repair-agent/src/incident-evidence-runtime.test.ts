import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import {
  INCIDENT_IDENTITY,
  INCIDENT_ADMITTED_AT,
  INCIDENT_PROPOSAL_INSTANCE,
} from "@effect-ci-testbed/github/incident-proposal";
import {
  INCIDENT_MODEL_RESERVATION,
  INCIDENT_MODEL_RUN,
  INCIDENT_MODEL_TEXT,
  INCIDENT_SUBMISSION,
  INCIDENT_AGENT_UID,
} from "@effect-ci-testbed/github/incident-evidence";

test(
  "actual local private evidence RPC and Workflow serialization read fake completed incident history without AI",
  { timeout: 60000 },
  async () => {
    const require = createRequire(import.meta.url);
    const plugin = await realpath(
      new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url),
    );
    const { Miniflare } = require(
      require.resolve("miniflare", { paths: [plugin] }),
    );
    const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
    const old = [
      {
        id: "probe_coverage-repair-budget-proposal-20261013-1",
        run: "native-budget-probe",
      },
      {
        id: "probe_coverage-repair-budget-stream-20261013-1",
        run: "native-budget-probe",
      },
      {
        id: "probe_coverage-repair-recovery-stream-20261014-1",
        run: "native-budget-probe",
      },
      {
        id: "flue_9215338e5c51bb55f8926ef9bcfb3186f4e970f83639929024685ab2ce2df43e",
        run: INCIDENT_MODEL_RUN,
      },
    ];
    const before = {
      budget: "friday-demo-repair-2-usd-v1",
      reservedCents: 40,
      remainingCents: 660,
      reservations: old,
    };
    const after = {
      ...before,
      reservedCents: 50,
      remainingCents: 650,
      reservations: [
        ...old,
        { id: INCIDENT_MODEL_RESERVATION, run: INCIDENT_MODEL_RUN },
      ],
    };
    const out = {
      admitted: {
        identity: INCIDENT_IDENTITY,
        admittedAt: INCIDENT_ADMITTED_AT,
        activationPolicy: "host-owned-incident-proposal-only-v1",
        instance: INCIDENT_PROPOSAL_INSTANCE,
        run: INCIDENT_MODEL_RUN,
      },
      proposal: {
        before,
        after,
        text: INCIDENT_MODEL_TEXT,
        reservationId: INCIDENT_MODEL_RESERVATION,
        proposalOnly: true,
        repairVerified: false,
        receipt: {
          submissionId: INCIDENT_SUBMISSION,
          uid: INCIDENT_AGENT_UID,
          acceptedAt: "2026-10-14T17:12:53.519Z",
        },
      },
      repairVerified: false,
      githubWritePerformed: false,
      eventActivation: "authenticated-operator-continuation-of-admitted-issue",
    };
    const compiled = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        contents: `
    import {WorkerEntrypoint,WorkflowEntrypoint} from 'cloudflare:workers';
    export {IncidentProposalEvidence,IncidentEvidenceWorkflow} from './incident-evidence.ts';
    // LOCAL synthetic history ONLY, not a generated model run or native evidence.
    export class IncidentProposalWorkflow extends WorkflowEntrypoint {run(){return ${JSON.stringify(out)}}}
    export default class Driver extends WorkerEntrypoint {async fetch(request){const p=new URL(request.url).pathname;
      if(p==='/start'){await this.ctx.exports.IncidentProposalWorkflow.create({id:${JSON.stringify(INCIDENT_PROPOSAL_INSTANCE)},params:{}});return Response.json({started:true})}
      if(p==='/source-status')return Response.json(await(await this.ctx.exports.IncidentProposalWorkflow.get(${JSON.stringify(INCIDENT_PROPOSAL_INSTANCE)})).status());
      if(p==='/read-start'){await this.ctx.exports.IncidentEvidenceWorkflow.create({id:'local-read-1',params:{mode:'read'}});return Response.json({started:true})}
      if(p==='/read-status')return Response.json(await(await this.ctx.exports.IncidentEvidenceWorkflow.get('local-read-1')).status());
      const e=this.ctx.exports.IncidentProposalEvidence({});if(p==='/public')return e.fetch(request);
      if(p==='/invalidate'){await this.env.REPAIR_AI.invalidate();return Response.json({invalid:true})}
      try {const r=await e.readIncident();return Response.json({instance:r.instance,reservationId:r.reservationId,run:r.run,text:r.text,issueId:r.issueId,operationId:r.operationId,activationPolicy:r.activationPolicy})} catch{return new Response('Rejected',{status:400})}
    }}`,
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      external: ["cloudflare:workers", "cloudflare:workflows", "node:*"],
      conditions: ["workerd", "import"],
    });
    const fake = `import {WorkerEntrypoint} from 'cloudflare:workers'; let invalid=false; export default class extends WorkerEntrypoint {status(){return invalid?{...${JSON.stringify(after)},reservedCents:0}:${JSON.stringify(after)}} invalidate(){invalid=true} runStream(){throw new Error('AI must not run')} fetch(){return new Response('Not found',{status:404})}}`;
    const runtime = new Miniflare({
      workers: [
        {
          config: {
            name: "incident-evidence-local",
            compatibilityDate: "2026-10-07",
            exports: {
              IncidentProposalEvidence: { type: "worker" },
              IncidentProposalWorkflow: {
                type: "workflow",
                name: "local-fake-incident-history",
              },
              IncidentEvidenceWorkflow: {
                type: "workflow",
                name: "local-evidence-reader",
              },
            },
            env: {
              REPAIR_AI: { type: "worker", worker: "fake-evidence-budget" },
            },
            manifest: {
              mainModule: "index.js",
              modules: {
                "index.js": {
                  type: "esm",
                  contents: compiled.outputFiles[0].text,
                },
              },
            },
          },
        },
        {
          config: {
            name: "fake-evidence-budget",
            compatibilityDate: "2026-10-07",
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: fake } },
            },
          },
        },
      ],
    });
    try {
      const call = (path: string) =>
        runtime.dispatchFetch(`https://owned.test${path}`);
      const wait = async (path: string) => {
        for (let i = 0; i < 200; i++) {
          const r = await (await call(path)).json();
          if (r.status === "complete") return r;
          assert.notEqual(r.status, "errored");
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error("Local Workflow did not complete");
      };
      assert.equal((await call("/public")).status, 404);
      assert.equal((await call("/read")).status, 400); // No complete history yet.
      await call("/start");
      await wait("/source-status");
      const read = await (await call("/read")).json();
      assert.equal(read.reservationId, INCIDENT_MODEL_RESERVATION);
      assert.equal(read.issueId, INCIDENT_IDENTITY.issueId);
      await call("/read-start");
      assert.deepEqual((await wait("/read-status")).output, read);
      await call("/invalidate");
      assert.equal((await call("/read")).status, 400);
    } finally {
      await runtime.dispose();
    }
  },
);
