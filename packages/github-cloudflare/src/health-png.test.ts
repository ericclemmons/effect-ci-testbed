import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { createHealthPngRenderer } from "./health-png.ts"

test("the actual WASM renderer produces bounded PNGs with owned memory and no runtime fetch", async () => {
  const wasm = await WebAssembly.compile(await readFile(fileURLToPath(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"))))
  const font = await readFile(new URL("../assets/ABeeZee-Regular.ttf.bin", import.meta.url))
  const render = createHealthPngRenderer(wasm, font)
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error("Rendering must not fetch") }
  try {
    const points = [{ elapsedSeconds: 0, decision: { status: "uncertain" as const, reason: "missing" } }]
    const [first, second] = await Promise.all([
      render(points, { baseline: "previous", candidate: "candidate", maxErrorRate: 0.1 }),
      render(points, { baseline: "<image href='https://example.com' />", candidate: "candidate", maxErrorRate: 0.1 }),
    ])
    assert.deepEqual([...first.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(first.buffer, first.byteOffset, first.byteLength)
    assert.equal(view.getUint32(16), 760)
    assert.equal(view.getUint32(20), 460)
    assert.ok(first.length > 1000 && first.length < 1_000_000)
    assert.notDeepEqual(first, second)
    const saved = new Uint8Array(first)
    for (let i = 0; i < 10; i++) await render(points, { baseline: "previous", candidate: "candidate", maxErrorRate: 0.1 })
    assert.deepEqual(first, saved)
    await assert.rejects(render(points, { baseline: "x".repeat(257), candidate: "new", maxErrorRate: 0.1 }))
    await assert.rejects(render(Array.from({ length: 101 }, (_, elapsedSeconds) => ({ ...points[0]!, elapsedSeconds })),
      { baseline: "old", candidate: "new", maxErrorRate: 0.1 }))
    await assert.rejects(render([{ ...points[0]!, elapsedSeconds: NaN }], { baseline: "old", candidate: "new", maxErrorRate: 0.1 }))
  } finally {
    globalThis.fetch = originalFetch
  }
})
