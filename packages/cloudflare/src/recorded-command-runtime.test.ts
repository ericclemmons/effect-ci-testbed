import assert from "node:assert/strict"
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"

test("native Workflow handles a lost launch/result RPC using one durable execution identity", { timeout: 30_000 }, async () => {
  const require = createRequire(import.meta.url)
  const plugin = realpathSync(new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url))
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }))
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }))
  const bundle = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {DurableObject,WorkflowEntrypoint} from 'cloudflare:workers';
    import * as Effect from 'effect/Effect';
    import * as CI from '@effect-ci-testbed/ci';
    import {makeRunner} from './index.ts';
    // Fixed simulated process backend. The Workflow, RPCs and SQLite are real;
    // shell completion/VM replacement is covered by the actual workspace test.
    export class WorkspaceContainer extends DurableObject {
      async launchRecordedCommand(id,args){
        if(await this.ctx.storage.get('id'))throw Error('Launch was repeated');
        await this.ctx.storage.put({id,args,launches:1});
        if(args[0]==='launch-ack')throw Error('Connection closed: this Durable Object instance is no longer active');
        return true;
      }
      async recordedCommandResult(id,args){
        if(await this.ctx.storage.get('id')!==id||JSON.stringify(await this.ctx.storage.get('args'))!==JSON.stringify(args))throw Error('Wrong identity');
        const reads=(await this.ctx.storage.get('reads')??0)+1;await this.ctx.storage.put('reads',reads);
        if(args[0]==='result-rpc'&&reads===1)throw Error('Connection closed: this Durable Object instance is no longer active');
        return {state:'complete',result:{exitCode:args[0]==='nonzero'?7:0,stdout:'original output',stderr:args[0]==='nonzero'?'original failure':''}};
      }
      async inspect(){return Object.fromEntries(await this.ctx.storage.list());}
    }
    export class Native extends WorkflowEntrypoint {
      async run(event,step){const runner=makeRunner({workspaceId:event.instanceId,repository:'https://github.com/acme/project',revision:'a'.repeat(40),
        binding:this.ctx.exports.WorkspaceContainer,step,durableCommands:true});
        return await Effect.runPromise(runner.executor.execute({command:event.payload.mode,commandIndex:0,stepId:'test',options:{},
          workspace:CI.Workspace.remote(event.instanceId,'/workspace'),onOutput(){}}));}
    }
    export default{async fetch(request,env,ctx){const p=await request.json();
      if(p.op==='start'){await ctx.exports.Native.create({id:p.mode,params:{mode:p.mode}});return Response.json({ok:true});}
      if(p.op==='status')return Response.json(await(await ctx.exports.Native.get(p.mode)).status());
      return Response.json(await ctx.exports.WorkspaceContainer.getByName(p.mode).inspect());}}
  ` }, bundle: true, write: false, format: "esm", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:*", "node:*"] })
  const runtime = new Miniflare({ workers: [{ config: {
    name: "recorded-command-runtime", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
    exports: { WorkspaceContainer: { type: "durable-object", storage: "sqlite" }, Native: { type: "workflow", name: "recorded-command" } },
  } }] })
  const call = async (op: string, mode: string): Promise<any> => (await runtime.dispatchFetch("https://fixture.invalid", {
    method: "POST", body: JSON.stringify({ op, mode }),
  })).json()
  try {
    for (const mode of ["launch-ack", "result-rpc", "nonzero"]) {
      await call("start", mode)
      let status: any
      for (let poll = 0; poll < 1000; poll++) {
        status = await call("status", mode)
        if (["complete", "errored"].includes(status.status)) break
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.equal(status.status, mode === "nonzero" ? "errored" : "complete", JSON.stringify(status))
      if (mode === "nonzero") assert.match(status.error.message, /7|original failure/)
      else assert.deepEqual(status.output, { exitCode: 0, stdout: "original output", stderr: "" })
      const actual = await call("inspect", mode)
      assert.equal(actual.launches, 1)
      assert.equal(actual.id, '["test",0]')
      assert.equal(actual.reads, mode === "result-rpc" ? 2 : 1)
    }
  } finally { await runtime.dispose() }
})
