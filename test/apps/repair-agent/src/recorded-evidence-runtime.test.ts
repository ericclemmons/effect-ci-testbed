import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));

test(
  "actual local evidence RPC reads retained Workflow status plus independent fake ledger, never dispatching AI",
  { timeout: 60_000 },
  async () => {
    const output = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        contents: `
    import {WorkerEntrypoint,WorkflowEntrypoint} from "cloudflare:workers";
    export {RecordedProposalEvidence} from "./recorded-evidence.ts";
    import {RECORDED_INSTANCE,RECORDED_RESERVATION,RECORDED_RUN,RECORDED_TEXT} from "../../../../packages/github/src/recorded-proposal.ts";
    const old=[{id:"old-a",run:"old-run-a"},{id:"old-b",run:"old-run-b"},{id:"old-c",run:"old-run-c"}],after=[...old,{id:RECORDED_RESERVATION,run:RECORDED_RUN}];
    // Fake historical contents. Actual local Workflow execution is not live Flue proof.
    export class ProposalProbeWorkflow extends WorkflowEntrypoint {
      run(){return {text:RECORDED_TEXT,reservationId:RECORDED_RESERVATION,proposalOnly:true,repairVerified:false,
        before:{budget:"friday-demo-repair-2-usd-v1",reservedCents:30,remainingCents:670,reservations:old},after:{budget:"friday-demo-repair-2-usd-v1",reservedCents:40,remainingCents:660,reservations:after}}}
    }
    export default class Driver extends WorkerEntrypoint {
      async fetch(request){
        const path=new URL(request.url).pathname,evidence=this.ctx.exports.RecordedProposalEvidence({});
        if(path==="/start"){await this.ctx.exports.ProposalProbeWorkflow.create({id:RECORDED_INSTANCE,params:{}});return Response.json({started:true})}
        if(path==="/status")return Response.json(await(await this.ctx.exports.ProposalProbeWorkflow.get(RECORDED_INSTANCE)).status());
        if(path==="/public")return evidence.fetch(request);
        if(path==="/invalidate"){await this.env.REPAIR_AI.invalidate();return Response.json({invalid:true})}
        let result=null,rejected=false;
        try{const value=await evidence.readRecorded();result={instance:value.instance,reservationId:value.reservationId,run:value.run,text:value.text}}
        catch{rejected=true}
        return Response.json({result,rejected,reads:await this.env.REPAIR_AI.count()});
      }
    }
  `,
      },
      bundle: true,
      platform: "neutral",
      format: "esm",
      target: "es2022",
      write: false,
      external: ["cloudflare:workers", "node:*"],
      conditions: ["workerd", "import"],
    });
    const fake = `import {WorkerEntrypoint} from "cloudflare:workers";let reads=0,invalid=false;
    export default class FakeBudget extends WorkerEntrypoint {
      status(){reads++;return {budget:"friday-demo-repair-2-usd-v1",reservedCents:40,remainingCents:660,reservations:[{id:"old-a",run:"old-run-a"},{id:"old-b",run:"old-run-b"},{id:"old-c",run:"old-run-c"},{id:${JSON.stringify("flue_9215338e5c51bb55f8926ef9bcfb3186f4e970f83639929024685ab2ce2df43e")},run:invalid?"foreign":"friday-flue-proposal-v1"}]}}
      count(){return reads}invalidate(){invalid=true}runStream(){throw new Error("Inference must not be called")}
      fetch(){return new Response("Not found",{status:404})}
    }`;
    const runtime = new Miniflare({
      workers: [
        {
          config: {
            name: "recorded-evidence-local",
            compatibilityDate: "2026-10-07",
            compatibilityFlags: ["nodejs_compat"],
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } },
            },
            exports: {
              RecordedProposalEvidence: { type: "worker" },
              ProposalProbeWorkflow: { type: "workflow", name: "local-retained-proposal" },
            },
            env: { REPAIR_AI: { type: "worker", worker: "fake-budget-local" } },
          },
        },
        {
          config: {
            name: "fake-budget-local",
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
      assert.equal((await runtime.dispatchFetch("https://owned.test/public")).status, 404);
      assert.equal((await runtime.dispatchFetch("https://owned.test/start")).status, 200);
      let ready = false;
      for (let i = 0; i < 200; i++) {
        const status = await (await runtime.dispatchFetch("https://owned.test/status")).json();
        if (status.status === "complete") {
          ready = true;
          break;
        }
        assert.notEqual(status.status, "errored");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(ready, true);
      const first = await (await runtime.dispatchFetch("https://owned.test/read")).json();
      assert.equal(first.rejected, false);
      assert.equal(first.reads, 1);
      assert.equal(first.result.instance, "coverage-flue-proposal-20261014-1");
      assert.equal(first.result.text, "export function healthStatus() { return 200; }");
      const second = await (await runtime.dispatchFetch("https://owned.test/read")).json();
      assert.deepEqual(second.result, first.result);
      assert.equal(second.reads, 2);
      await runtime.dispatchFetch("https://owned.test/invalidate");
      const denied = await (await runtime.dispatchFetch("https://owned.test/read")).json();
      assert.equal(denied.rejected, true);
      assert.equal(denied.result, null);
      assert.equal(denied.reads, 3);
    } finally {
      await runtime.dispose();
    }
  },
);
