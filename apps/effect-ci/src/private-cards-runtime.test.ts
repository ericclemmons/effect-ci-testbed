import assert from "node:assert/strict"
import { realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
const require = createRequire(import.meta.url)
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }))
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }))

test("actual SQLite card owner posts once, updates one ts, and stops after lost acknowledgement", { timeout: 30_000 }, async () => {
  const output = await build({ stdin: { contents: `
    export {PrivateSlackCards} from "./private-cards.ts";
    const calls=[];let threadPosts=0;
    globalThis.fetch=async(url,init)=>{
      const req=new Request(url,init);if(req.redirect!=="manual")throw new Error("Unsafe redirects");
      const body=await req.json();calls.push({method:String(url),ts:body.ts,text:body.text,threadTs:body.thread_ts,broadcast:body.reply_broadcast});
      if(body.text==="lost")throw new Error("Accepted upstream but response lost");
      return Response.json({ok:true,channel:"CHANNEL",ts:body.ts||(body.thread_ts?"1791685465."+(700000+(++threadPosts)):"1791685465.683799")});
    };
    export default {async fetch(req,env){
      const {owner,sequence,text,thread,existing}=await req.json();const stub=env.CARDS.getByName(owner);
      const frame={text,blocks:[{type:"section",text:{type:"plain_text",text}}]};
      const send=()=>existing?stub.publishExisting(owner,sequence,frame):thread?stub.publishThread(owner,thread,sequence,frame):stub.publish(owner,sequence,frame);
      const results=await Promise.all([send(),send()]);
      return Response.json({results,calls});
    }};
  `, resolveDir: new URL(".", import.meta.url).pathname, sourcefile: "card-probe.ts", loader: "ts" },
    bundle: true, write: false, format: "esm", target: "esnext", external: ["cloudflare:workers"] })
  const name = "private-card-ledger-probe"
  const runtime = new Miniflare({ workers: [{ config: {
    name, compatibilityDate: "2026-10-07",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    exports: { PrivateSlackCards: { type: "durable-object", storage: "sqlite" } },
    env: { CARDS: { type: "durable-object", worker: name, exportName: "PrivateSlackCards" },
      SLACK_BOT_TOKEN: { type: "json", value: "test-only-token" }, SLACK_APP_ID: { type: "json", value: "APP" },
      SLACK_TEAM_ID: { type: "json", value: "TEAM" }, SLACK_CHANNEL_ID: { type: "json", value: "CHANNEL" } },
  } }] })
  const send = async (owner: string, sequence: number, text: string, thread?: string, existing = false) => (await runtime.dispatchFetch("https://probe.invalid",
    { method: "POST", body: JSON.stringify({ owner, sequence, text, thread, existing }) })).json()
  try {
    assert.equal((await send("run", 0, "start")).calls.length, 1)
    const replay = await send("run", 0, "start")
    assert.ok(replay.results.every((result: { ok: boolean }) => result.ok))
    assert.equal(replay.calls.length, 1)
    const update = await send("run", 1, "phase10")
    assert.equal(update.calls.length, 2)
    assert.ok(update.calls[1].method.endsWith("chat.update"))
    assert.equal(update.calls[1].ts, "1791685465.683799")
    assert.equal((await send("run", 0, "start")).calls.length, 2)
    assert.equal((await send("run", 2, "lost")).calls.length, 3)
    assert.equal((await send("run", 2, "lost")).calls.length, 3)
    assert.equal((await send("run", 3, "later")).calls.length, 3)
    assert.equal((await send("first-lost", 0, "lost")).calls.length, 4)
    const blocked = await send("first-lost", 1, "later")
    assert.equal(blocked.calls.length, 4)
    assert.ok(blocked.results.every((result: { ok: boolean }) => !result.ok))
    const missingParent = await send("orphan", 0, "details", "10")
    assert.equal(missingParent.calls.length, 4)
    assert.ok(missingParent.results.every((result: {ok:boolean}) => !result.ok))
    await send("thread-run", 0, "root")
    const reply = await send("thread-run", 1, "stage10", "10")
    assert.equal(reply.calls.length, 6)
    assert.equal(reply.calls.at(-1).threadTs, "1791685465.683799")
    assert.equal(reply.calls.at(-1).broadcast, false)
    assert.equal((await send("thread-run", 1, "stage10", "10")).calls.length, 6)
    assert.equal((await send("thread-run", 2, "stage10", "10")).calls.length, 6, "identical frames reuse native SQLite receipts")
    const changed = await send("thread-run", 3, "new samples", "10")
    assert.equal(changed.calls.length, 7)
    assert.equal(changed.calls.at(-1).ts, "1791685465.700001")
    assert.equal(changed.calls.at(-1).threadTs, undefined)
    assert.equal((await send("thread-run", 4, "lost", "10")).calls.length, 8)
    assert.equal((await send("thread-run", 5, "later", "10")).calls.length, 8)
    const orphanReconciliation = await send("reconcile-orphan", 4, "existing PR", undefined, true)
    assert.equal(orphanReconciliation.calls.length, 8)
    assert.ok(orphanReconciliation.results.every((r: {ok:boolean}) => !r.ok))
    await send("reconcile-owned", 3, "stopped")
    const reconciled = await send("reconcile-owned", 4, "existing verified PR", undefined, true)
    assert.equal(reconciled.calls.length, 10)
    assert.equal(reconciled.calls.at(-1).ts, "1791685465.683799")
    assert.ok(reconciled.calls.at(-1).method.endsWith("chat.update"))
    assert.equal((await send("reconcile-owned", 4, "existing verified PR", undefined, true)).calls.length, 10)
  } finally { await runtime.dispose() }
})
