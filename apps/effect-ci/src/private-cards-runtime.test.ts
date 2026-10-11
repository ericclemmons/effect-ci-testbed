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
    const calls=[];
    globalThis.fetch=async(url,init)=>{
      const req=new Request(url,init);if(req.redirect!=="manual")throw new Error("Unsafe redirects");
      const body=await req.json();calls.push({method:String(url),ts:body.ts,text:body.text});
      if(body.text==="lost")throw new Error("Accepted upstream but response lost");
      return Response.json({ok:true,channel:"CHANNEL",ts:"1791685465.683799"});
    };
    export default {async fetch(req,env){
      const {owner,sequence,text}=await req.json();const stub=env.CARDS.getByName(owner);
      const frame={text,blocks:[{type:"section",text:{type:"plain_text",text}}]};
      const results=await Promise.all([stub.publish(owner,sequence,frame),stub.publish(owner,sequence,frame)]);
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
  const send = async (owner: string, sequence: number, text: string) => (await runtime.dispatchFetch("https://probe.invalid",
    { method: "POST", body: JSON.stringify({ owner, sequence, text }) })).json()
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
  } finally { await runtime.dispose() }
})
