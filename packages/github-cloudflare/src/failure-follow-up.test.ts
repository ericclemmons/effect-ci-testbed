import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";

test("a private failed-attempt continuation cannot turn the original native failure green or replace its error", { timeout: 30_000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = realpathSync(new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const output = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {DurableObject} from 'cloudflare:workers';
    import * as CI from '@effect-ci-testbed/ci';
    import * as Effect from 'effect/Effect';
    import {workflowEntrypoint} from './index.ts';
    const observed=[],followups=[];
    export class WorkspaceContainer extends DurableObject{}
    const prepared=CI.action('install',()=>function*(){return 31});
    const failed=CI.action('test',function*(){yield* prepared();return function*(){yield* Effect.fail(new CI.CommandError('test','fixed test','/fixture',7));}});
    const definition=CI.workflow('primary',()=>failed());
    export const Failed=workflowEntrypoint(definition,{cache:false,
      onAttempt:async(attempt,context)=>{observed.push(attempt.conclusion);if(context.parameters.ref==='observation-fails')throw Error('PRIVATE RECORD FAILURE')},
      onFailure:async(context)=>{
        if(!(context.error instanceof CI.CommandError))throw Error('Original typed error was lost');
        if(context.attempt.conclusion!=='failure'||context.attempt.outputs.install!==31||observed.length!==followups.length+1)throw Error('Actual failed attempt missing');
        const verification=CI.action('independent verification',()=>function*(){return 'verified candidate, not original CI success'});
        const result=await CI.runPromise(CI.workflow('modeled-followup',()=>verification()),{output:'silent'});
        followups.push({primary:context.attempt.conclusion,verification:result.attempt.conclusion});
        if(context.parameters.ref==='followup-fails')throw Error('PRIVATE FOLLOWUP FAILURE');
      }});
    export default{async fetch(request,env,ctx){const p=await request.json();
      if(p.op==='start'){await ctx.exports.Failed.create({id:p.id,params:{trigger:'remote',repository:'https://github.com/example/project.git',revision:'a'.repeat(40),ref:p.id}});return Response.json(true)}
      if(p.op==='status')return Response.json(await(await ctx.exports.Failed.get(p.id)).status());
      return Response.json({observed,followups});
    }};
  ` }, bundle: true, write: false, format: "esm", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:*", "node:*"] });
  const runtime = new Miniflare({ workers: [{ config: { name: "failed-attempt-continuation", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    exports: { WorkspaceContainer: { type: "durable-object", storage: "sqlite" }, Failed: { type: "workflow", name: "failed-attempt-continuation" } },
  } }] });
  const call = async (body: unknown): Promise<any> => (await runtime.dispatchFetch("https://fixture.invalid", { method: "POST", body: JSON.stringify(body) })).json();
  try {
    for (const id of ["verified-followup", "followup-fails", "observation-fails"]) {
      await call({ op: "start", id });
      let status: any;
      for (let n = 0; n < 500; n++) {
        status = await call({ op: "status", id });
        if (status.status === "errored") break;
        assert.notEqual(status.status, "complete", "a verification result must not convert primary CI to success");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(status.status, "errored");
      assert.ok(status.error.message.includes(id === "observation-fails" ? "Host attempt recording failed" : "Command failed (7): fixed test"), JSON.stringify(status.error));
      assert.ok(!status.error.message.includes("PRIVATE FOLLOWUP FAILURE"));
      assert.ok(!status.error.message.includes("PRIVATE RECORD FAILURE"));
    }
    const state = await call({ op: "inspect" });
    assert.deepEqual(state.observed, ["failure", "failure", "failure"]);
    assert.deepEqual(state.followups, [{ primary: "failure", verification: "success" }, { primary: "failure", verification: "success" }]);
  } finally { await runtime.dispose(); }
});
