import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

test(
  "optional notification checkpoint failures preserve business outcomes and other providers",
  { timeout: 60000 },
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
      const observations=[];let posts=0,attempts=0,providerAttempts=0;const policies=[],providerPolicies=[];
      globalThis.fetch=async()=>{posts++;throw Error('Unexpected notification retry');};
      export class WorkspaceContainer extends DurableObject{}
      const make=(fails,mode='throw')=>{
        const action=CI.action('business',()=>function*(){observations.push('business');if(fails)throw Error('Original business failure');return 'done';});
        const Base=workflowEntrypoint(CI.workflow('isolation',()=>action()),{
          cache:false,
          notificationProviders:()=>[
            ...(mode==='provider-timeout'?[{id:'stalled',deliver:()=>{providerAttempts++;return Effect.never;}}]:[]),
            {id:'healthy',deliver:(run)=>Effect.sync(()=>{observations.push(run.phase);return {message:'one'};})}],
        });
        return class extends Base {
          async run(event,step){
            const wrapped=new Proxy(step,{get(target,key){
              if(key==='do')return (...args)=>{
                if(args[0].startsWith('notification-provider:'))providerPolicies.push(args[1]);
                if(args[0].startsWith('notification:')){
                  policies.push(args[1]);
                  return target.do(args[0],args[1],()=>{
                    attempts++;
                    if(mode==='timeout')return new Promise(()=>{});
                    if(mode==='reject')return Promise.reject(Error('secret transport failure'));
                    throw Error('secret transport failure');
                  });
                }
                return target.do(...args);
              };
              const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
            }});
            return super.run(event,wrapped);
          }
        };
      };
      export const Success=make(false),Failure=make(true),Rejected=make(false,'reject'),TimedOut=make(false,'timeout'),ProviderTimedOut=make(false,'provider-timeout');
      export default {async fetch(request,env,ctx){const p=await request.json();
        if(p.op==='start'){observations.length=0;policies.length=0;providerPolicies.length=0;posts=attempts=providerAttempts=0;await ctx.exports[p.name].create({id:p.name.toLowerCase(),params:{trigger:'remote',repository:'https://github.com/owner/repo.git',revision:'a'.repeat(40)}});return Response.json({started:true});}
        if(p.op==='status')return Response.json(await(await ctx.exports[p.name].get(p.name.toLowerCase())).status());
        return Response.json({observations,posts,attempts,policies,providerPolicies,providerAttempts});
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
              Rejected: { type: "workflow", name: "rejected" },
              TimedOut: { type: "workflow", name: "timed-out" },
              ProviderTimedOut: { type: "workflow", name: "provider-timed-out" },
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
      for (const name of ["Success", "Failure", "Rejected", "TimedOut", "ProviderTimedOut"]) {
        await call({ op: "start", name });
        let status: any;
        for (let n = 0; n < 1500; n++) {
          status = await call({ op: "status", name });
          if (["complete", "errored"].includes(status.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(
          status.status,
          name === "Failure" ? "errored" : "complete",
          JSON.stringify(status),
        );
        const state = await call({});
        assert.equal(state.attempts, 1, "uncertain delivery blocks later channel attempts");
        assert.equal(state.posts, 0);
        assert.ok(state.providerPolicies.length > 0);
        assert.ok(state.providerPolicies.every((policy: any) => policy?.retries?.limit === 0 && policy.timeout === "20 seconds"));
        assert.equal(state.providerAttempts, name === "ProviderTimedOut" ? 1 : 0,
          "An uncertain provider timeout cannot retry delivery on a later event");
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
          state.observations.includes(name === "Failure" ? "failure" : "success"),
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
