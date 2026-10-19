import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

test(
  "native candidate inspection reads fixed metadata without credentials, network or journal writes",
  { timeout: 30_000 },
  async () => {
    const require = createRequire(import.meta.url);
    const plugin = realpathSync(
      new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url),
    );
    const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
    const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
    const previous = "030c9f540e0906bea570380d208b8e7473a502ae";
    const failed = "a39a6801acb2818e2df9877dd2293c91c28325ed";
    const bundle = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        loader: "ts",
        contents: `
    import{ReleaseJournalObject as Base,CandidateInspectionWorkflow}from'./worker.ts';
    import{RELEASE_SCRIPT}from'./release-manager.ts';
    export{CandidateInspectionWorkflow};
    globalThis.fetch=async()=>{throw Error('Inspection must never access network');};
    export class ReleaseJournalObject extends Base{
      async seed(){await this.ctx.storage.put({'candidate-index-v1':Array.from({length:32},(_,i)=>i.toString(16).padStart(40,'0')),
        'candidate:${previous}':{status:'complete'},release:{status:'rolled-back'}});}
      async snapshot(){return Array.from(await this.ctx.storage.list());}
    }
    export default{async fetch(request,env,ctx){const input=await request.json();const journal=ctx.exports.ReleaseJournalObject.getByName(RELEASE_SCRIPT);
      if(input.op==='seed'){await journal.seed();return Response.json({seeded:true});}
      if(input.op==='snapshot')return Response.json(await journal.snapshot());
      if(input.op==='start'){await ctx.exports.CandidateInspectionWorkflow.create({id:input.id,params:input.params});return Response.json({started:true});}
      return Response.json(await(await ctx.exports.CandidateInspectionWorkflow.get(input.id)).status());
    }};`,
      },
      bundle: true,
      write: false,
      format: "esm",
      target: "esnext",
      external: ["cloudflare:*", "node:*"],
    });
    const runtime = new Miniflare({
      workers: [
        {
          config: {
            name: "candidate-inspection-test",
            compatibilityDate: "2026-10-07",
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } },
            },
            exports: {
              ReleaseJournalObject: { type: "durable-object", storage: "sqlite" },
              CandidateInspectionWorkflow: { type: "workflow", name: "candidate-inspection-test" },
            },
          },
        },
      ],
    });
    const call = async (input: unknown): Promise<any> =>
      (
        await runtime.dispatchFetch("https://fixture.invalid", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).json();
    const run = async (id: string, params: unknown) => {
      await call({ op: "start", id, params });
      for (let n = 0; n < 100; n++) {
        const status = await call({ id });
        if (["complete", "errored"].includes(status.status)) return status;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.fail("Inspection did not terminate");
    };
    try {
      await call({ op: "seed" });
      const before = await call({ op: "snapshot" });
      const result = await run("read-only", {});
      assert.equal(result.status, "complete");
      assert.deepEqual(
        result.output,
        [previous, failed].map((revision, index) => ({
          revision,
          count: 32,
        capacity: 256,
          present: index === 0,
          status: index === 0 ? "complete" : "absent",
          releaseStatus: "rolled-back",
          pendingRelease: false,
        })),
      );
      assert.equal((await run("bad-input", { revision: failed })).status, "errored");
      assert.deepEqual(await call({ op: "snapshot" }), before);
    } finally {
      await runtime.dispose();
    }
  },
);
