import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

test(
  "actual recovery Workflow accepts only the fixed tuple and copies the private RPC receipt",
  { timeout: 30000 },
  async () => {
    const require = createRequire(import.meta.url);
    const plugin = realpathSync(
      new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url),
    );
    const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
    const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
    const output = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        loader: "ts",
        contents: `
    import{WorkerEntrypoint}from'cloudflare:workers';
    import{originalCandidate,assertRecoveryPayload}from'./demo-candidate-recovery.ts';
    export{DemoCandidateRecoveryWorkflow}from'./demo-candidate-recovery.ts';
    let calls=0;
    export class Broker extends WorkerEntrypoint{async reconcileCandidate(revision,digest,version){
      if(revision!==originalCandidate.revision||digest!==originalCandidate.digest||version!==originalCandidate.version)throw Error('Foreign identity');
      calls++;return {...originalCandidate,policy:'owned-vite-release-pointer-v1',script:'effect-ci-hmd-demo'};
    }}
    export default{async fetch(request,env,ctx){const p=await request.json();
      if(p.mode==='start'){await ctx.exports.DemoCandidateRecoveryWorkflow.create({id:p.id,params:p.payload});return Response.json({started:true});}
      if(p.mode==='status')return Response.json(await(await ctx.exports.DemoCandidateRecoveryWorkflow.get(p.id)).status());
      let invoked=0;try{assertRecoveryPayload(Object.defineProperty({},'mode',{get(){invoked++;return 'reconcile-original'}}));throw Error('Accessor accepted');}catch{};
      return Response.json({calls,invoked});
    }};`,
      },
      bundle: true,
      write: false,
      format: "esm",
      target: "esnext",
      external: ["cloudflare:workers", "node:*"],
    });
    const runtime = new Miniflare({
      workers: [
        {
          config: {
            name: "recovery-test",
            compatibilityDate: "2026-10-07",
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } },
            },
            exports: {
              DemoCandidateRecoveryWorkflow: { type: "workflow", name: "recovery-test" },
              Broker: { type: "worker" },
            },
            env: {
              RELEASE_MANAGER: { type: "worker", worker: "recovery-test", exportName: "Broker" },
            },
          },
        },
      ],
    });
    const call = async (body: unknown): Promise<any> =>
      (
        await runtime.dispatchFetch("https://test.invalid", {
          method: "POST",
          body: JSON.stringify(body),
        })
      ).json();
    async function terminal(id: string) {
      for (let n = 0; n < 100; n++) {
        const state = await call({ mode: "status", id });
        if (["complete", "errored"].includes(state.status)) return state;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw Error("Recovery Workflow did not terminate");
    }
    try {
      await call({
        mode: "start",
        id: "reject",
        payload: { mode: "reconcile-original", version: "foreign" },
      });
      assert.equal((await terminal("reject")).status, "errored");
      assert.equal((await call({})).calls, 0);
      await call({ mode: "start", id: "recover", payload: { mode: "reconcile-original" } });
      const state = await terminal("recover");
      assert.equal(state.status, "complete");
      assert.equal(state.output.version, "d91c0765-1994-4aad-8aad-f359374c2f45");
      assert.equal(state.output.uploadPerformed, false);
      assert.equal(state.output.deploymentPerformed, false);
      assert.deepEqual(await call({}), { calls: 1, invoked: 0 });
    } finally {
      await runtime.dispose();
    }
  },
);
