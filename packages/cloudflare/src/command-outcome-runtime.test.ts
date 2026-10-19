import assert from "node:assert/strict"
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"

test("container RPC failure is an unknown command outcome, not a fabricated exit 1", { timeout: 30_000 }, async () => {
  const require = createRequire(import.meta.url)
  const plugin = realpathSync(new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url))
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }))
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }))
  const bundle = await build({
    stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
      import * as Effect from 'effect/Effect';
      import * as Exit from 'effect/Exit';
      import * as Cause from 'effect/Cause';
      import * as CI from '@effect-ci-testbed/ci';
      import {makeRunner} from './index.ts';
      export default {async fetch(request){
        const input=await request.json();let calls=0;
        const runner=makeRunner({workspaceId:'fixture',repository:'https://github.com/acme/project.git',revision:'a'.repeat(40),
          binding:{getByName(){return {execute:async()=>{calls++;
            if(input.mode==='exit')return {exitCode:7,stdout:'test context',stderr:'assertion failed'};
            throw Error('private-provider-cause TOKEN=must-not-leak');
          }};}},
          step:{do:async(name,config,body)=>{try{return await body({attempt:1});}catch(error){if(input.serialized)throw Error(error.message);throw error;}}}});
        const execute=()=>runner.executor.execute({command:'node --test',stepId:'test',
          workspace:CI.Workspace.remote('fixture','/workspace'),options:{},onOutput:()=>{}});
        const operation=input.action?runner.actionExecutor.execute({stepId:'test',options:{},
          run:()=>execute().pipe(Effect.map(value=>({value,commands:[]})))}):execute();
        const exit=await Effect.runPromiseExit(operation);
        const error=Exit.isFailure(exit)?Cause.squash(exit.cause):undefined;
        return Response.json({calls,name:error?.name,tag:error?._tag,message:error?.message,
          stage:error?.stage,processExitCode:error?.processExitCode,effects:error?.effects,exitCode:error?.exitCode,output:error?.output});
      }};` },
    bundle: true, write: false, format: "esm", target: "esnext",
    conditions: ["workerd", "import"], external: ["cloudflare:*", "node:*"],
  })
  const runtime = new Miniflare({ workers: [{ config: {
    name: "command-outcome-test", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
  } }] })
  const call = async (input: unknown) => {
    const response = await runtime.dispatchFetch("https://fixture.invalid", { method: "POST", body: JSON.stringify(input) })
    const text = await response.text()
    assert.equal(response.status, 200, text)
    return JSON.parse(text)
  }
  try {
    for (const serialized of [false, true]) {
      const failure = await call({ serialized })
      assert.equal(failure.calls, 1, "unknown outcomes must not replay the command")
      assert.equal(failure.tag, "CommandExecutionError")
      assert.equal(failure.stage, "container-execution")
      assert.equal(failure.processExitCode, null)
      assert.equal(failure.effects, "unknown")
      assert.equal("exitCode" in failure, false)
      assert.equal("output" in failure, false)
      assert.ok(!JSON.stringify(failure).includes("must-not-leak"))
      assert.match(failure.message, /process exit unknown/)
    }
    const observed = await call({ mode: "exit" })
    assert.equal(observed.tag, "CommandError")
    assert.equal(observed.exitCode, 7)
    assert.equal(observed.output.stderr, "assertion failed")
    assert.equal(observed.calls, 1)
    for (const serialized of [false, true]) {
      const action = await call({ action: true, serialized })
      assert.equal(action.calls, 1)
      assert.match(action.message, /stage=container-execution; process exit unknown/)
      assert.equal("exitCode" in action, false)
      assert.ok(!JSON.stringify(action).includes("must-not-leak"))
    }
  } finally { await runtime.dispose() }
})
