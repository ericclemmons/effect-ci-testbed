import assert from "node:assert/strict"
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"

test("native workflows retain a typed parallel failure instead of [object Array]", { timeout: 30000 }, async () => {
  const require = createRequire(import.meta.url)
  const plugin = realpathSync(new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url))
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }))
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }))
  const bundle = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {DurableObject} from 'cloudflare:workers';
    import * as CI from '@effect-ci-testbed/ci';
    import * as Effect from 'effect/Effect';
    import * as Cloudflare from '@effect-ci-testbed/cloudflare';
    import {workflowEntrypoint} from './index.ts';
    let executions=0,completed=0,sequence=0;const sent=[];
    globalThis.fetch=async(input,init)=>{
      const url=new URL(String(input));
      if(url.pathname.endsWith('/chat.getPermalink'))return Response.json({ok:true,channel:'COWNED',permalink:'https://fixture.slack.com/archives/COWNED/p'+url.searchParams.get('message_ts').replace('.','')});
      const body=JSON.parse(init.body);sent.push(body);
      return Response.json({ok:true,ts:body.ts??String(++sequence)+'.000001'});
    };
    export class WorkspaceContainer extends DurableObject{}
    const failed=CI.action('test',()=>function*(){executions++;yield* Effect.fail(new CI.CommandExecutionError('test','node --test','/fixture'));});
    const sibling=CI.action('check',()=>function*(){completed++;});
    const definition=CI.workflow('parallel',()=>CI.parallel([failed(),sibling()]));
    export const Reporting=workflowEntrypoint(definition,{cache:false,slackLayout:'status-thread'});
    export const Native=Cloudflare.workflowEntrypoint(definition,{cache:false});
    export default{async fetch(request,env,ctx){const p=await request.json();
      if(p.op==='start'){await ctx.exports[p.name].create({id:p.name,params:{trigger:'remote',repository:'https://github.com/owner/repo.git',revision:'a'.repeat(40)}});return Response.json({ok:true});}
      if(p.op==='status')return Response.json(await(await ctx.exports[p.name].get(p.name)).status());
      return Response.json({executions,completed,sent});
    }};
  ` }, bundle: true, write: false, format: "esm", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:*", "node:*"] })
  const runtime = new Miniflare({ workers: [{ config: {
    name: "parallel-failure", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
    exports: { WorkspaceContainer: { type: "durable-object", storage: "sqlite" },
      Reporting: { type: "workflow", name: "reporting" }, Native: { type: "workflow", name: "native" } },
    env: { SLACK_BOT_TOKEN: { type: "text", value: "local-fake-token" }, SLACK_CHANNEL_ID: { type: "text", value: "COWNED" } },
  } }] })
  const call = async (value: unknown): Promise<any> => (await runtime.dispatchFetch("https://fixture.invalid", {
    method: "POST", body: JSON.stringify(value),
  })).json()
  try {
    for (const name of ["Reporting", "Native"]) {
      await call({ op: "start", name })
      let status: any
      for (let n = 0; n < 1000; n++) {
        status = await call({ op: "status", name })
        if (["complete", "errored"].includes(status.status)) break
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.equal(status.status, "errored")
      assert.ok(status.error.message.includes("Container command result unavailable"), JSON.stringify(status.error))
      assert.ok(status.error.message.includes("process exit unknown"))
      assert.ok(!status.error.message.includes("[object Array]"))
    }
    const state = await call({})
    assert.equal(state.executions, 2)
    assert.equal(state.completed, 2)
    const posts = state.sent.filter((body: any) => !body.ts)
    assert.equal(posts.length, 3, "one root and one reply for each actual parallel step")
    assert.ok(!state.sent.some((body: any) => body.blocks?.some((block: any) => block.type === "table")))
    const failedPost = posts.find((body: any) => /test/.test(body.text))
    const detail = state.sent.filter((body: any) => body.ts === String(posts.indexOf(failedPost) + 1) + ".000001").at(-1)
    assert.ok(detail.text.includes("Process exit unknown"))
    assert.ok(detail.text.includes("No stdout or stderr was captured"))
    assert.ok(detail.text.includes("do not rerun automatically"))
    assert.ok(!JSON.stringify(state.sent).includes("local-fake-token"))
    for (const body of state.sent.filter((body: any) => body.ts === "1.000001"))
      assert.ok(!body.text.includes("Process exit unknown"), "the parent remains compact")
  } finally { await runtime.dispose() }
})
