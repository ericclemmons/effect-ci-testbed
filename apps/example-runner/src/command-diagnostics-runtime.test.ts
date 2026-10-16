import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { realpath } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

test("actual local Workflow failed checkpoints retain both command streams without retry", { timeout: 60000 }, async () => {
  const pkg = fileURLToPath(new URL("../", import.meta.url)), require = createRequire(import.meta.url)
  const plugin = await realpath(join(pkg, "node_modules/@cloudflare/vite-plugin"))
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }))
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }))
  const ci = fileURLToPath(new URL("../../../packages/ci/src/index.ts", import.meta.url))
  const command = fileURLToPath(new URL("../../../packages/cloudflare/src/command-step.ts", import.meta.url))
  const action = fileURLToPath(new URL("../../../packages/cloudflare/src/action-step.ts", import.meta.url))
  const errors = fileURLToPath(new URL("../../../packages/cloudflare/src/command-error.ts", import.meta.url))
  const code = (await build({ stdin: { resolveDir: pkg, loader: "ts", contents: `
    import {WorkerEntrypoint,WorkflowEntrypoint} from 'cloudflare:workers';
    import * as CI from ${JSON.stringify(ci)};
    import * as Effect from 'effect/Effect';import * as Cause from 'effect/Cause';import * as Exit from 'effect/Exit';
    import {executeCommandStep} from ${JSON.stringify(command)};
    import {makeActionExecutor} from ${JSON.stringify(action)};
    import {commandFailure} from ${JSON.stringify(errors)};
    export class DiagnosticWorkflow extends WorkflowEntrypoint {
      async run(event,step){
        let executions=0;const request={stepId:'compile',command:'node check.mjs',workspace:CI.Workspace.remote('local','/workspace'),options:{retries:{limit:0,delay:'1 second'}}};
        const result={exitCode:7,stdout:'compiler context\\n',stderr:'missing export\\n'};
        let error;
        if(event.payload.mode==='command'){
          try{await executeCommandStep(step,request,async()=>{executions++;return result;});}
          catch(e){error=e;}
        }else{
          const exit=await Effect.runPromiseExit(makeActionExecutor(step,new Set()).execute({stepId:'compile',options:request.options,run:()=>{executions++;return Effect.fail(commandFailure(request,result));}}));
          if(Exit.isFailure(exit))error=Cause.squash(exit.cause);
        }
        if(!(error instanceof CI.CommandError))throw Error('Local failed checkpoint lost typed diagnostics');
        // LOCAL catcher only: production CI leaves the Workflow errored. The
        // native checkpoint above still THREW and was never cached as success.
        return {caughtForLocalInspection:true,executions,stepId:error.stepId,exitCode:error.exitCode,output:error.output};
      }
    }
    export default class extends WorkerEntrypoint {async fetch(request){const w=this.ctx.exports.DiagnosticWorkflow;
      if(request.method==='POST'){const p=await request.json();return Response.json(await w.create({id:p.mode,params:{mode:p.mode}}));}
      return Response.json(await(await w.get(new URL(request.url).searchParams.get('id'))).status());}}
  ` }, bundle: true, write: false, format: "esm", platform: "neutral", external: ["node:*", "cloudflare:workers", "cloudflare:workflows"] })).outputFiles[0].text
  const runtime = new Miniflare({ workers: [{ config: { name: "local-command-diagnostics", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    exports: { DiagnosticWorkflow: { type: "workflow", name: "local-command-diagnostics" } },
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: code } } },
  } }] })
  try {
    for (const mode of ["command", "action"]) {
      assert.equal((await runtime.dispatchFetch("https://local.invalid/", { method: "POST", body: JSON.stringify({ mode }) })).status, 200)
      let state: any
      for (let i = 0; i < 200; i++) {
        state = await (await runtime.dispatchFetch(`https://local.invalid/?id=${mode}`)).json()
        if (["complete", "errored"].includes(state.status)) break
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      assert.equal(state.status, "complete", JSON.stringify(state))
      assert.deepEqual(state.output, { caughtForLocalInspection: true, executions: 1, stepId: "compile", exitCode: 7,
        output: { stdout: "compiler context\n", stderr: "missing export\n", truncated: false } })
    }
  } finally { await runtime.dispose() }
})
