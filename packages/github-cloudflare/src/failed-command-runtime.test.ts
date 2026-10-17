import assert from "node:assert/strict"
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"

test("failure-output presentation remains browser-safe without Node executors", async () => {
  const require = createRequire(import.meta.url)
  const plugin = realpathSync(new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url))
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }))
  const bundle = await build({ entryPoints: [new URL("./failed-command-output.ts", import.meta.url).pathname],
    bundle: true, write: false, format: "esm", platform: "browser" })
  assert.equal(bundle.outputFiles.length, 1)
  assert.doesNotMatch(bundle.outputFiles[0].text, /node:child_process|node:fs|node:path/)
})

for (const logMode of ["inline", "snippet", "lost-ack"] as const) test(`native failed output: ${logMode} stays in the same Slack thread`, { timeout: 30000 }, async () => {
  const require = createRequire(import.meta.url)
  const plugin = realpathSync(new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url))
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }))
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }))
  const bundle = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {DurableObject} from 'cloudflare:workers';
    import * as CI from '@effect-ci-testbed/ci';import * as Effect from 'effect/Effect';
    import {workflowEntrypoint} from './index.ts';
    export {PrivateSlackImages} from '../../../apps/effect-ci/src/private-images.ts';
    const sent=[],files=[];let sequence=0,runs=0;
    globalThis.fetch=async(url,init)=>{
      if(String(url).includes('getUploadURLExternal')){files.push({allocation:true});return Response.json({ok:true,file_id:'F123',upload_url:'https://files.slack.com/upload/v1/test'});}
      if(String(url).startsWith('https://files.slack.com/')){if(new Headers(init.headers).has('authorization'))throw Error('Token leak');files.push({text:new TextDecoder().decode(init.body)});return new Response('OK');}
      if(String(url).includes('completeUploadExternal')){files.push(JSON.parse(init.body));if('${logMode}'==='lost-ack')throw Error('Lost acknowledgement');return Response.json({ok:true,files:[{id:'F123'}]});}
      if(String(url).includes('/chat.getPermalink?')){const u=new URL(url),channel=u.searchParams.get('channel'),ts=u.searchParams.get('message_ts');return Response.json({ok:true,channel,permalink:'https://fixture.slack.com/archives/'+channel+'/p'+ts.replace('.','')+'?thread_ts=1.000001&cid='+channel});}const body=JSON.parse(init.body);sent.push(body);
      return Response.json({ok:true,ts:body.ts??String(++sequence)+'.000001'});};
    export class WorkspaceContainer extends DurableObject{}
    const action=CI.action('test',()=>function*(){runs++;return yield* Effect.fail(new CI.CommandError('test','pnpm test','/fixture',1,undefined,
      {stdout:'Expected hello\\nReceived goodbye\\n'+'x'.repeat(1600),stderr:'Assertion failed\\nowned-private-value\\n',truncated:false}));},{retries:{limit:0,delay:0}});
    export const Failure=workflowEntrypoint(CI.workflow('cf-ci-demo',()=>action()),{cache:false,slackLayout:'status-thread',slackCommandOutput:'failed',
      ...('${logMode}'==='inline'?{}:{slackCommandLog:({exports,instanceId,stepId,threadTs,text})=>exports.PrivateSlackImages.getByName(instanceId).uploadLog(instanceId,stepId,threadTs,text)})});
    export default{async fetch(request,env,ctx){const p=await request.json();
      if(p.op==='start'){await ctx.exports.Failure.create({id:'failure',params:{trigger:'remote',repository:'https://github.com/owner/repo.git',revision:'a'.repeat(40)}});return Response.json({started:true});}
      if(p.op==='status')return Response.json(await(await ctx.exports.Failure.get('failure')).status());
      if(p.op==='replay')return Response.json(await ctx.exports.PrivateSlackImages.getByName('failure').uploadLog('failure','test','1.000001',p.text));
      return Response.json({sent,runs,files});}};
  ` }, bundle: true, write: false, format: "esm", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:workers", "node:*"] })
  const runtime = new Miniflare({ workers: [{ config: {
    name: "failed-command-output", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
    exports: { WorkspaceContainer: { type: "durable-object", storage: "sqlite" }, PrivateSlackImages: { type: "durable-object", storage: "sqlite" }, Failure: { type: "workflow", name: "failure" } },
    env: { SLACK_BOT_TOKEN: { type: "text", value: "owned-private-value" }, SLACK_CHANNEL_ID: { type: "text", value: "COWNED" },
      SLACK_APP_ID: { type: "text", value: "APP" }, SLACK_TEAM_ID: { type: "text", value: "TEAM" } },
  } }] })
  const call = async (op: string): Promise<any> => (await runtime.dispatchFetch("https://test.invalid", { method: "POST", body: JSON.stringify({ op }) })).json()
  try {
    await call("start")
    let status: any
    for (let n = 0; n < 1000; n++) {
      status = await call("status")
      if (["complete", "errored"].includes(status.status)) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(status.status, "errored")
    const { sent, runs, files } = await call("inspect")
    assert.equal(runs, 1, "output presentation must not rerun the failed action")
    const posts = sent.filter((body: any) => !body.ts)
    assert.equal(posts.length, 3, "one root, one details table and one maintained step reply")
    const root = "1.000001", reply = "3.000001"
    assert.equal(posts[1].text, "Preparing steps…")
    assert.equal(posts[2].thread_ts, root)
    assert.equal(posts[2].reply_broadcast, false)
    const latestReply = sent.filter((body: any) => body.ts === reply).at(-1)
    if (logMode === "snippet") {
      assert.match(JSON.stringify(latestReply), /Captured output attached in this thread/)
      assert.doesNotMatch(JSON.stringify(latestReply), /Expected hello/)
    } else {
      assert.match(JSON.stringify(latestReply), /Expected hello/)
      assert.match(JSON.stringify(latestReply), /Received goodbye/)
      assert.doesNotMatch(JSON.stringify(latestReply), /Captured output attached/)
    }
    if (logMode !== "inline") {
      assert.equal(files.length, 3)
      assert.equal(files[2].channel_id, "COWNED"); assert.equal(files[2].thread_ts, root)
      assert.match(files[1].text, /Expected hello/)
      assert.doesNotMatch(JSON.stringify(files), /owned-private-value/)
      const replay = await (await runtime.dispatchFetch("https://test.invalid", { method: "POST", body: JSON.stringify({ op: "replay", text: files[1].text }) })).json()
      assert.deepEqual(replay, logMode === "snippet" ? { ok: true, fileId: "F123" } : { ok: false })
      assert.equal((await call("inspect")).files.length, 3, "actual Durable Object receipt prevents duplicate files")
    } else assert.equal(files.length, 0)
    assert.match(JSON.stringify(latestReply), /Assertion failed/)
    assert.match(JSON.stringify(latestReply), /exit 1/)
    const summary = sent.filter((body: any) => body.ts === "2.000001").at(-1)
    assert.equal(summary.blocks[0].type, "table")
    assert.match(summary.text, /test: failed/)
    assert.match(JSON.stringify(summary), /https:\/\/fixture.slack.com\/archives\/COWNED\/p3000001/)
    assert.doesNotMatch(JSON.stringify(summary), /Expected hello|Assertion failed|Field|Value/)
    assert.doesNotMatch(JSON.stringify(sent), /owned-private-value|effect-ci-command-error-v1/)
    for (const body of sent.filter((body: any) => body.ts === root))
      assert.doesNotMatch(JSON.stringify(body), /Expected hello|Assertion failed/)
  } finally { await runtime.dispose() }
})
