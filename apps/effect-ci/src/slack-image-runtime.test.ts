import assert from "node:assert/strict"
import { realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }))
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }))

test("private Slack image uploader's actual RequestInit works in workerd and rejects redirects", { timeout: 30_000 }, async () => {
  const output = await build({ stdin: { contents: `
    import { uploadPrivateSlackImage } from "../../../packages/github-cloudflare/src/slack-images.ts";
    export default { async fetch(request) {
      const redirectAt = Number(new URL(request.url).searchParams.get("redirectAt") ?? 0);
      const png = new Uint8Array(33); png.set([137,80,78,71,13,10,26,10]);
      const view = new DataView(png.buffer); view.setUint32(8,13); view.setUint32(12,0x49484452);
      view.setUint32(16,760); view.setUint32(20,350);
      let calls=0;
      const result = await uploadPrivateSlackImage("test-only-token", png, async (url, init) => {
        // Use workerd's real Request validation, but never contact Slack.
        const outbound = new Request(url, init); calls++;
        if(outbound.redirect!=="manual") throw new Error("Redirect forwarding possible");
        if(calls===2 && outbound.headers.has("authorization")) throw new Error("Upload credential leak");
        if(calls===redirectAt) return new Response(null,{status:307,headers:{location:"https://evil.invalid"}});
        if(calls===1) return Response.json({ok:true,file_id:"F123",upload_url:"https://files.slack.com/upload/v1/test"});
        if(calls===2) return new Response("OK");
        return Response.json({ok:true,files:[{id:"F123",is_public:false}]});
      });
      return Response.json({result,calls});
    } };
  `, resolveDir: new URL(".", import.meta.url).pathname, sourcefile: "slack-image-probe.ts", loader: "ts" },
    bundle: true, write: false, format: "esm", target: "esnext" })
  const runtime = new Miniflare({ workers: [{ config: {
    name: "slack-image-transport-probe", compatibilityDate: "2026-10-07",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
  } }] })
  try {
    const response = await runtime.dispatchFetch("https://probe.invalid")
    assert.deepEqual(await response.json(), { result: { ok: true, fileId: "F123" }, calls: 3 })
    for (const redirectAt of [1, 2, 3]) {
      const redirected = await runtime.dispatchFetch(`https://probe.invalid?redirectAt=${redirectAt}`)
      assert.deepEqual(await redirected.json(), { result: { ok: false }, calls: redirectAt })
    }
  } finally { await runtime.dispose() }
})
