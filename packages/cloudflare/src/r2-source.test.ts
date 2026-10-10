import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readR2Source } from "./r2-source.ts"

const source = (files: unknown[]) => {
  const body = new TextEncoder().encode(JSON.stringify({ version: 1, files }))
  return { bucket: { get: async () => ({ size: body.byteLength, arrayBuffer: async () => body.buffer }) },
    digest: createHash("sha256").update(body).digest("hex") }
}
const file = (path = "source.txt", base64 = "c291cmNlIGZyb20gcjIK") => ({ path, base64, executable: false })

test("R2 source preserves binary data and executable bits after verifying exact content", async () => {
  const files = [file(), { path: "bin/run", base64: "AP8K", executable: true }]
  const { bucket, digest } = source(files)
  assert.deepEqual(await readR2Source(bucket, "source/immutable.json", digest), files)
  await assert.rejects(readR2Source(bucket, "source/immutable.json", "0".repeat(64)), /digest mismatch/)
  await assert.rejects(readR2Source(bucket, "source/immutable.json", "latest"), /reference/)
})

test("R2 source rejects traversal, duplicate paths, directory conflicts and noncanonical encoding", async () => {
  for (const files of [[file("../escape")], [file("/absolute")], [file("a\\b")], [file(), file()],
    [file("app"), file("app/main.ts")], [file("app/main.ts"), file("app")], [file("ok", "QQ")]]) {
    const { bucket, digest } = source(files)
    await assert.rejects(readR2Source(bucket, "source/test", digest))
  }
})

test("R2 source fails closed on absent objects, size mismatch and byte/entry limits", async () => {
  await assert.rejects(readR2Source({ get: async () => null }, "source/test", "a".repeat(64)), /not found/)
  const valid = source([file()])
  const object = await valid.bucket.get()
  await assert.rejects(readR2Source({ get: async () => ({ ...object, size: object.size + 1 }) }, "source/test", valid.digest), /size mismatch/)
  for (const files of [[file("big", btoa("x".repeat(65537)))], Array.from({ length: 1001 }, (_, i) => file(String(i)))]) {
    const { bucket, digest } = source(files)
    await assert.rejects(readR2Source(bucket, "source/test", digest))
  }
})
