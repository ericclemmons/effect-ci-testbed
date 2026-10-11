import assert from "node:assert/strict"
import { readFile, realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }))
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }))

test("compiled WASM chart renders inside workerd without network or runtime compilation", { timeout: 30_000 }, async () => {
  const output = await build({
    stdin: { contents: `
      import wasm from "./chart.wasm";
      import font from "./font.bin";
      import { createHealthPngRenderer } from "../../../packages/github-cloudflare/src/health-png.ts";
      const render = createHealthPngRenderer(wasm, new Uint8Array(font));
      export default { async fetch() {
        globalThis.fetch = () => { throw new Error("No network during rendering"); };
        const png = await render([{ elapsedSeconds: 0, decision: { status: "uncertain", reason: "missing" } }],
          { baseline: "previous", candidate: "candidate", maxErrorRate: .1 });
        return new Response(png, { headers: { "content-type": "image/png" } });
      } };
    `, resolveDir: new URL(".", import.meta.url).pathname, sourcefile: "chart-probe.ts", loader: "ts" },
    bundle: true, write: false, format: "esm", target: "esnext", external: ["./chart.wasm", "./font.bin"],
  })
  const runtime = new Miniflare({ workers: [{ config: {
    name: "health-chart-probe", compatibilityDate: "2026-10-07",
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: output.outputFiles[0].text },
      "chart.wasm": { type: "wasm", contents: new Uint8Array(await readFile(
        require.resolve("@resvg/resvg-wasm/index_bg.wasm"))) },
      "font.bin": { type: "data", contents: new Uint8Array(await readFile(new URL(
        "../../../packages/github-cloudflare/assets/ABeeZee-Regular.ttf.bin", import.meta.url))) },
    } },
  } }] })
  try {
    for (let i = 0; i < 2; i++) {
      const response = await runtime.dispatchFetch("https://chart.invalid")
      assert.equal(response.status, 200)
      assert.equal(response.headers.get("content-type"), "image/png")
      const png = new Uint8Array(await response.arrayBuffer())
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
      assert.ok(png.length > 1000 && png.length < 1_000_000)
      const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
      assert.equal(view.getUint32(16), 760)
      assert.equal(view.getUint32(20), 300)
    }
  } finally { await runtime.dispose() }
})
