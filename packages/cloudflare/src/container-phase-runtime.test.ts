import assert from "node:assert/strict"
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"

test("container process phase survives actual Durable Object RPC without provider cause text", { timeout: 30_000 }, async () => {
  const require = createRequire(import.meta.url)
  const plugin = realpathSync(new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url))
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }))
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }))
  const bundle = await build({
    stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
      import {DurableObject} from 'cloudflare:workers';
      import * as Effect from 'effect/Effect';
      import * as Exit from 'effect/Exit';
      import * as Cause from 'effect/Cause';
      import * as CI from '@effect-ci-testbed/ci';
      import {WorkspaceContainer,makeRunner} from './index.ts';
      export class Probe extends DurableObject {
        async execute(command,cwd,stepId){
          const mode=command;let calls=0;
          const reject=()=>{throw Error('private-provider-cause TOKEN=must-not-leak');};
          const container={running:true,exec:async()=>{calls++;if(mode==='start')reject();return {output:async()=>{
            if(mode==='output')reject();return {exitCode:7,stdout:new Uint8Array(),stderr:new TextEncoder().encode('real failure')};
          }};}};
          const host=Object.create(WorkspaceContainer.prototype);
          Object.defineProperties(host,{ctx:{value:{storage:this.ctx.storage,container}},env:{value:{}},
            materialize:{value:async()=>{}},configureOutbound:{value:async()=>{if(mode==='prepare')reject();}}});
          try{return await host.execute(command,cwd,stepId);}finally{await this.ctx.storage.put('calls',calls);}
        }
        calls(){return this.ctx.storage.get('calls');}
      }
      export default {async fetch(request,env,ctx){
        const mode=await request.text(),binding=ctx.exports.Probe;
        const runner=makeRunner({workspaceId:'fixture',repository:'https://github.com/acme/project.git',revision:'a'.repeat(40),binding,
          step:{do:async(name,config,body)=>{try{return await body();}catch(error){throw Error(error.message);}}}});
        const exit=await Effect.runPromiseExit(runner.executor.execute({command:mode,stepId:'test',
          workspace:CI.Workspace.remote('fixture','/workspace'),options:{},onOutput:()=>{}}));
        const error=Exit.isFailure(exit)?Cause.squash(exit.cause):undefined;
        return Response.json({tag:error?._tag,phase:error?.phase,message:error?.message,processExitCode:error?.processExitCode,
          exitCode:error?.exitCode,output:error?.output,calls:await binding.getByName('fixture').calls()});
      }};` },
    bundle: true, write: false, format: "esm", target: "esnext",
    conditions: ["workerd", "import"], external: ["cloudflare:*", "node:*"],
  })
  const runtime = new Miniflare({ workers: [{ config: {
    name: "container-phase-test", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
    exports: { Probe: { type: "durable-object", storage: "sqlite" } },
  } }] })
  try {
    for (const phase of ["prepare", "start", "output"]) {
      const response = await runtime.dispatchFetch("https://fixture.invalid", { method: "POST", body: phase })
      const text = await response.text()
      assert.equal(response.status, 200, text)
      const result = JSON.parse(text)
      assert.equal(result.tag, "CommandExecutionError")
      assert.equal(result.phase, phase)
      assert.equal(result.processExitCode, null)
      assert.equal("exitCode" in result, false)
      assert.equal("output" in result, false)
      assert.equal(result.calls, phase === "prepare" ? 0 : 1)
      assert.ok(!text.includes("must-not-leak"))
    }
    const observed = await (await runtime.dispatchFetch("https://fixture.invalid", { method: "POST", body: "exit" })).json() as any
    assert.equal(observed.tag, "CommandError")
    assert.equal(observed.exitCode, 7)
    assert.equal(observed.output.stderr, "real failure")
  } finally { await runtime.dispose() }
})
