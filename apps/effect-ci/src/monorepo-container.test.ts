import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));

test("main deployment commands receive process-only credentials; checks, fixtures and completed runs do not", async () => {
  const output = await build({
    stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
      import {WorkspaceContainer} from './monorepo-container.ts';
      import {DurableObject} from 'cloudflare:workers';
      export class Probe extends DurableObject {
        calls;
        host;
        constructor(ctx,env){
          const calls=[];
          const container={running:true,destroy:async()=>{container.running=false;},exec:async(command,options)=>{
            calls.push({command:command.at(-1),authorized:!!options?.env?.CLOUDFLARE_API_TOKEN});
            return {output:async()=>({exitCode:0,stdout:new TextEncoder().encode(options?.env?.CLOUDFLARE_API_TOKEN??'ok'),stderr:new Uint8Array()})};
          }};
          super(ctx,env);
          this.host=Object.create(WorkspaceContainer.prototype);
          Object.defineProperties(this.host,{
            ctx:{value:{storage:ctx.storage,container}},env:{value:env},
            queue:{value:Promise.resolve(),writable:true},
            materialize:{value:async()=>{}},
          });
          this.calls=calls;
        }
        execute(...args){return this.host.execute(...args);}
        stop(){return this.host.stop();}
        allowMainDeployment(revision){return this.host.allowMainDeployment(revision);}
        async inspect(){return {calls:this.calls,stored:[...await this.ctx.storage.list()]};}
      }
      export default {async fetch(request,env,ctx){
        const stub=ctx.exports.Probe.getByName('deployment-test');
        const command='./node_modules/.bin/cf deploy --prebuilt',cwd='/workspace/repository/apps/effect-ci';
        const denied=await stub.execute(command,cwd,'deploy effect-ci');
        await stub.allowMainDeployment('a'.repeat(40));
        await stub.execute('pnpm check','/workspace/repository','check');
        await stub.execute(command,cwd,'foreign-action');
        const published=await stub.execute(command,cwd,'deploy effect-ci');
        await stub.execute(command,'/workspace/repository/test/apps/repair-ai','deploy repair-ai');
        const before=await stub.inspect();
        await stub.stop();
        const stopped=await stub.execute(command,cwd,'deploy effect-ci');
        return Response.json({denied,published,stopped,before,after:await stub.inspect()});
      }};
    ` },
    bundle: true, format: "esm", platform: "neutral", target: "esnext", write: false,
    external: ["cloudflare:workers", "node:*"], conditions: ["workerd", "import"],
  });
  const runtime = new Miniflare({ workers: [{ config: {
    name: "main-deploy-environment-test", compatibilityDate: "2026-10-07",
    compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    exports: { Probe: { type: "durable-object", storage: "sqlite" } },
    env: { CLOUDFLARE_API_TOKEN: { type: "text", value: "private-fixture-token" },
      CLOUDFLARE_ACCOUNT_ID: { type: "text", value: "fixture-account" } },
  } }] });
  try {
    const response = await runtime.dispatchFetch("https://fixture.invalid/");
    const body = await response.text();
    assert.equal(response.status, 200, body);
    const result = JSON.parse(body);
    assert.equal(result.denied.exitCode, 1);
    assert.equal(result.stopped.exitCode, 1);
    assert.equal(result.published.exitCode, 0);
    assert.equal(result.published.stdout, "[redacted]");
    assert.deepEqual(result.before.calls.map((call: any) => call.authorized), [false, false, true, false]);
    assert.ok(result.before.stored.some(([key]: any) => key === "mainDeployment"));
    assert.ok(result.after.stored.every(([key]: any) => key !== "mainDeployment"));
    assert.ok(!JSON.stringify(result).includes("private-fixture-token"));
  } finally { await runtime.dispose(); }
});
