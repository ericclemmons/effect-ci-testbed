import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

test(
  "host finalization retains one Slack card and defers success; build/release failures never claim success",
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
    import{DurableObject}from'cloudflare:workers';
    import*as CI from'@effect-ci-testbed/ci';
    import{workflowEntrypoint}from'./index.ts';
    const messages=[],finalizations=[];let missingCard=false,failedNotice=false;
    globalThis.fetch=async(input,init)=>{const url=String(input);if(!url.startsWith('https://slack.com/api/'))throw Error('Unexpected external request');
      const body=JSON.parse(init.body);messages.push({url,body});return Response.json({ok:!missingCard&&!(failedNotice&&body.text==='Release still running'),ts:'123.456'});};
    export class WorkspaceContainer extends DurableObject{}
    const make=(failBuild=false)=>{const build=CI.action('build',()=>function*(){if(failBuild)throw Error('Build fixture failed');return {version:'candidate-1'};});return CI.workflow('release-fixture',function*(){return yield*build();});};
    const options=(fail=false)=>({cache:false,finalize:async(ctx)=>{
      finalizations.push({value:ctx.value,phase:ctx.card.snapshot().phase,instance:ctx.instanceId});
      await ctx.step.do('release:validate',{retries:{limit:0,delay:'1 second'}},async()=>{if(ctx.value.version!=='candidate-1')throw Error('Wrong candidate');return {validated:true};});
      await ctx.publish('review',{text:'Release still running',blocks:[{type:'section',text:{type:'plain_text',text:'Release still running'}}]});
      if(fail)throw Error('Host release failure canary');
    }});
    export const Success=workflowEntrypoint(make(),options());
    export const FailedRelease=workflowEntrypoint(make(),options(true));
    export const FailedBuild=workflowEntrypoint(make(true),options());
    export const MissingCard=workflowEntrypoint(make(),options());
    export const FailedNotice=workflowEntrypoint(make(),options());
    export const Default=workflowEntrypoint(make(),{cache:false});
    export default{async fetch(request,env,ctx){const p=await request.json();
      if(p.op==='start'){messages.length=0;finalizations.length=0;missingCard=p.name==='MissingCard';failedNotice=p.name==='FailedNotice';await ctx.exports[p.name].create({id:p.id,params:{trigger:'remote',repository:'https://github.com/owner/repo.git',revision:'a'.repeat(40)}});return Response.json({started:true});}
      if(p.op==='status')return Response.json(await(await ctx.exports[p.name].get(p.id)).status());
      return Response.json({messages,finalizations});
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
            name: "finalizer-test",
            compatibilityDate: "2026-10-07",
            compatibilityFlags: ["nodejs_compat"],
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } },
            },
            exports: {
              WorkspaceContainer: { type: "durable-object", storage: "sqlite" },
              ...Object.fromEntries(
                [
                  "Success",
                  "FailedRelease",
                  "FailedBuild",
                  "MissingCard",
                  "FailedNotice",
                  "Default",
                ].map((name) => [name, { type: "workflow", name: name.toLowerCase() }]),
              ),
            },
            env: {
              SLACK_BOT_TOKEN: { type: "text", value: "fake-local-slack-token" },
              SLACK_CHANNEL_ID: { type: "text", value: "fake-channel" },
            },
          },
        },
      ],
    });
    const call = async (p: unknown): Promise<any> =>
      (
        await runtime.dispatchFetch("https://test.invalid", {
          method: "POST",
          body: JSON.stringify(p),
        })
      ).json();
    const run = async (name: string) => {
      const id = name.toLowerCase();
      await call({ op: "start", name, id });
      for (let n = 0; n < 200; n++) {
        const status = await call({ op: "status", name, id });
        if (["complete", "errored"].includes(status.status)) return { status, ...(await call({})) };
        await new Promise((r) => setTimeout(r, 20));
      }
      throw Error("Workflow did not terminate");
    };
    try {
      for (const name of [
        "Success",
        "FailedRelease",
        "FailedBuild",
        "MissingCard",
        "FailedNotice",
        "Default",
      ]) {
        const result = await run(name);
        const failed = name.startsWith("Failed") || name === "MissingCard";
        assert.equal(
          result.status.status,
          failed ? "errored" : "complete",
          JSON.stringify(result.status.error),
        );
        if (name === "MissingCard") {
          assert.equal(
            result.messages.filter((m: any) => m.body.text === "Release still running").length,
            0,
            "No replacement card after missing ACK",
          );
          assert.equal(result.finalizations[0].phase, "running");
          continue;
        }
        assert.equal(
          result.messages.filter((m: any) => m.url.endsWith("/chat.postMessage")).length,
          1,
        );
        for (const message of result.messages.slice(1)) {
          assert.ok(message.url.endsWith("/chat.update"));
          assert.equal(message.body.ts, "123.456");
        }
        if (name === "Success" || name === "FailedRelease" || name === "FailedNotice") {
          assert.deepEqual(result.finalizations, [
            { value: { version: "candidate-1" }, phase: "running", instance: name.toLowerCase() },
          ]);
          const review = result.messages.findIndex(
            (m: any) => m.body.text === "Release still running",
          );
          assert.ok(review >= 0);
          assert.ok(
            !result.messages
              .slice(0, review + 1)
              .some((m: any) => /CI succeeded/.test(m.body.text)),
          );
          assert.equal(
            result.messages.filter((m: any) => m.body.text === "Release still running").length,
            1,
            "Host notification must not retry",
          );
        } else assert.equal(result.finalizations.length, 0);
        const last = result.messages.at(-1).body.text;
        assert.match(last, failed ? /failed|failure/i : /passed|success|succeeded/i);
        if (failed) assert.ok(!result.messages.some((m: any) => /CI succeeded/.test(m.body.text)));
      }
    } finally {
      await runtime.dispose();
    }
  },
);
