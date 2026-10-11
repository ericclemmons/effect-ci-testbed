import assert from "node:assert/strict"
import { realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }))
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }))

test("actual SQLite Durable Object reserves once and replays a private image receipt", { timeout: 30_000 }, async () => {
  const output = await build({ stdin: { contents: `
    export {PrivateSlackImages} from "./private-images.ts";
    let calls=0;
    globalThis.fetch=async (url,init)=>{
      const req=new Request(url,init);calls++;
      if(req.redirect!=="manual")throw new Error("Unsafe redirect mode");
      if(String(url).startsWith("https://files.slack.com")) {
        if(req.headers.has("authorization"))throw new Error("Credential leak");
        return new Response("OK");
      }
      if(String(url).endsWith("files.getUploadURLExternal"))return Response.json({ok:true,file_id:"F123",upload_url:"https://files.slack.com/upload/v1/test"});
      const body=await req.json();if(body.channel_id||body.thread_ts)throw new Error("File must stay private");
      return Response.json({ok:true,files:[{id:"F123",is_public:false}]});
    };
    export default {async fetch(req,env){
      const png=new Uint8Array(33);png.set([137,80,78,71,13,10,26,10]);const v=new DataView(png.buffer);
      v.setUint32(8,13);v.setUint32(12,0x49484452);v.setUint32(16,760);v.setUint32(20,350);
      if(new URL(req.url).pathname==="/changed")png[32]=1;
      const stub=env.IMAGES.getByName("run-1");
      const results=await Promise.all([stub.upload("run-1","a".repeat(64),png),stub.upload("run-1","a".repeat(64),png)]);
      return Response.json({results,calls});
    }};
  `, resolveDir: new URL(".", import.meta.url).pathname, sourcefile: "receipt-probe.ts", loader: "ts" },
    bundle: true, write: false, format: "esm", target: "esnext", external: ["cloudflare:workers"] })
  const name = "private-image-ledger-probe"
  const runtime = new Miniflare({ workers: [{ config: {
    name, compatibilityDate: "2026-10-07",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    exports: { PrivateSlackImages: { type: "durable-object", storage: "sqlite" } },
    env: {
      IMAGES: { type: "durable-object", worker: name, exportName: "PrivateSlackImages" },
      SLACK_BOT_TOKEN: { type: "json", value: "test-only-token" },
      SLACK_APP_ID: { type: "json", value: "APP" }, SLACK_TEAM_ID: { type: "json", value: "TEAM" },
      SLACK_CHANNEL_ID: { type: "json", value: "CHANNEL" },
    },
  } }] })
  try {
    const initial = await (await runtime.dispatchFetch("https://probe.invalid")).json()
    assert.equal(initial.calls, 3)
    assert.ok(initial.results.some((r: { ok: boolean }) => r.ok))
    const replay = await (await runtime.dispatchFetch("https://probe.invalid")).json()
    assert.deepEqual(replay, { results: [{ ok: true, fileId: "F123" }, { ok: true, fileId: "F123" }], calls: 3 })
    const changed = await (await runtime.dispatchFetch("https://probe.invalid/changed")).json()
    assert.deepEqual(changed, { results: [{ ok: false }, { ok: false }], calls: 3 })
  } finally { await runtime.dispose() }
})
