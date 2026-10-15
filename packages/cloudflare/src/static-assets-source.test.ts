import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { prepareStaticAssets } from "./static-assets-source.ts"

const revision = "a".repeat(40)
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex")
const file = (path: string, text = "hello") => ({ path, base64: Buffer.from(text).toString("base64"), executable: false })
const fixture = () => ({ version: 1, files: [file("site/style.css"), file("site/index.html"), file("site/app.js")] })
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const prepare = (value: unknown) => { const bytes = encode(value); return prepareStaticAssets(revision, bytes, hash(bytes)) }

test("prepares only the fixed target and canonical assets with independent full byte hashes", async () => {
  const result = await prepare(fixture())
  assert.equal(result.target, "effect-ci-static-assets-demo")
  assert.deepEqual(result.assets.map(asset => asset.path), ["app.js", "index.html", "style.css"])
  assert.equal(result.assets[0]!.sha256, hash("hello"))
  assert.deepEqual(result.uploadManifest["/app.js"], { hash: hash("aGVsbG8=js").slice(0, 32), size: 5 })
  assert.notEqual(result.assets[0]!.uploadHash, hash("hello").slice(0, 32))
  const reordered = await prepare({ ...fixture(), files: fixture().files.reverse() })
  assert.deepEqual(reordered.assets, result.assets)
  assert.equal(reordered.assetDigest, result.assetDigest)
  assert.notEqual(reordered.manifestDigest, result.manifestDigest)
})

test("owns bytes before hashing and rejects identity mismatch and mutable revisions", async () => {
  const bytes = encode(fixture()), digest = hash(bytes)
  const pending = prepareStaticAssets(revision, bytes, digest)
  bytes.fill(0)
  assert.equal((await pending).revision, revision)
  await assert.rejects(prepareStaticAssets(revision, encode(fixture()), "0".repeat(64)), /digest mismatch/)
  await assert.rejects(prepareStaticAssets("main", encode(fixture()), digest), /revision/)
})

test("rejects extra keys, foreign/duplicate paths, executable files and invalid encodings", async () => {
  for (const value of [
    { ...fixture(), target: "foreign" },
    { ...fixture(), files: [...fixture().files, file("site/extra.js")] },
    { ...fixture(), files: [file("site/style.css"), file("site/index.html"), file("site/../app.js")] },
    { ...fixture(), files: [file("site/style.css"), file("site/index.html"), file("site/index.html")] },
    { ...fixture(), files: fixture().files.map(entry => ({ ...entry, executable: true })) },
    { ...fixture(), files: fixture().files.map(entry => ({ ...entry, url: "https://foreign.invalid" })) },
    { ...fixture(), files: fixture().files.map(entry => ({ ...entry, base64: "/w==" })) },
    { ...fixture(), files: fixture().files.map(entry => ({ ...entry, base64: "aGVsbG8" })) },
    { ...fixture(), files: fixture().files.map(entry => ({ ...entry, base64: "AA==" })) },
  ]) await assert.rejects(prepare(value))
})

test("enforces per-file and aggregate bounds before any upload", async () => {
  await assert.rejects(prepare({ version: 1, files: [file("site/app.js", "x".repeat(32769)), file("site/index.html"), file("site/style.css")] }), /byte limit/)
  await assert.rejects(prepare({ version: 1, files: [file("site/app.js", "x".repeat(23000)), file("site/index.html", "x".repeat(23000)), file("site/style.css", "x".repeat(23000))] }), /byte limit/)
  await assert.rejects(prepareStaticAssets(revision, new Uint8Array(96 * 1024 + 1), "0".repeat(64)), /bytes/)
})
