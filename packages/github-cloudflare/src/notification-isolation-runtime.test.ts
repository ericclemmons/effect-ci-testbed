import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

test(
  "optional notification checkpoint failures preserve business outcomes and other providers",
  { timeout: 30000 },
  async () => {
    const require = createRequire(import.meta.url);
    const plugin = realpathSync(
      new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url),
    );
    const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
    const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
    const bundle = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        loader: "ts",
        contents: `
      import {DurableObject} from 'cloudflare:workers';
      import * as CI from '@effect-ci-testbed/ci';
      import * as Effect from 'effect/Effect';
      import {workflowEntrypoint} from './index.ts';
      const observations=[];let posts=0,attempts=0;const policies=[];
      globalThis.fetch=async()=>{posts++;throw Error('Unexpected notification retry');};
      export class WorkspaceContainer extends DurableObject{}
      const make=(fails)=>{
        const action=CI.action('business',()=>function*(){observations.push('business');if(fails)throw Error('Original business failure');return 'done';});
        const Base=workflowEntrypoint(CI.workflow('isolation',()=>action()),{
          cache:false,
          notificationProviders:()=>[{id:'healthy',deliver:(run)=>Effect.sync(()=>{observations.push(run.phase);return {message:'one'};})}],
        });
        return class extends Base {
          async run(event,step){
            const wrapped=new Proxy(step,{get(target,key){
              if(key==='do')return (...args)=>{
                if(args[0].startsWith('notification:')){attempts++;policies.push(args[1]);throw Error('secret transport failure');}
                return target.do(...args);
              };
              const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
            }});
            return super.run(event,wrapped);
          }
        };
      };
      export const Success=make(false),Failure=make(true);
      export default {async fetch(request,env,ctx){const p=await request.json();
        if(p.op==='start'){observations.length=0;policies.length=0;posts=0;attempts=0;await ctx.exports[p.name].create({id:p.name.toLowerCase(),params:{trigger:'remote',repository:'https://github.com/owner/repo.git',revision:'a'.repeat(40)}});return Response.json({started:true});}
        if(p.op==='status')return Response.json(await(await ctx.exports[p.name].get(p.name.toLowerCase())).status());
        return Response.json({observations,posts,attempts,policies});
      }};`,
      },
      bundle: true,
      write: false,
      format: "esm",
      target: "esnext",
      conditions: ["workerd", "import"],
      external: ["cloudflare:workers", "node:*"],
    });
    const runtime = new Miniflare({
      workers: [
        {
          config: {
            name: "notification-isolation",
            compatibilityDate: "2026-10-07",
            compatibilityFlags: ["nodejs_compat"],
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } },
            },
            exports: {
              WorkspaceContainer: { type: "durable-object", storage: "sqlite" },
              Success: { type: "workflow", name: "success" },
              Failure: { type: "workflow", name: "failure" },
            },
            env: {
              SLACK_BOT_TOKEN: { type: "text", value: "fake-local-token" },
              SLACK_CHANNEL_ID: { type: "text", value: "fake-channel" },
            },
          },
        },
      ],
    });
    const call = async (value: unknown): Promise<any> =>
      (
        await runtime.dispatchFetch("https://test.invalid", {
          method: "POST",
          body: JSON.stringify(value),
        })
      ).json();
    try {
      for (const name of ["Success", "Failure"]) {
        await call({ op: "start", name });
        let status: any;
        for (let n = 0; n < 200; n++) {
          status = await call({ op: "status", name });
          if (["complete", "errored"].includes(status.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(
          status.status,
          name === "Success" ? "complete" : "errored",
          JSON.stringify(status),
        );
        const state = await call({});
        assert.equal(state.attempts, 1, "uncertain delivery blocks later channel attempts");
        assert.equal(state.posts, 0);
        assert.deepEqual(state.policies, [
          { retries: { limit: 0, delay: "1 second" }, timeout: "20 seconds" },
        ]);
        assert.ok(
          status.__LOCAL_DEV_STEP_OUTPUTS.some(
            (output: any) =>
              output.status === "failed" &&
              output.reason === "checkpoint" &&
              output.reconciliationRequired === true,
          ),
        );
        assert.ok(state.observations.includes("business"));
        assert.ok(
          state.observations.includes(name === "Success" ? "success" : "failure"),
          JSON.stringify(state),
        );
        if (name === "Failure")
          assert.match(JSON.stringify(status.error), /Original business failure/);
        assert.ok(!JSON.stringify(status).includes("secret transport"));
      }
    } finally {
      await runtime.dispose();
    }
  },
);
