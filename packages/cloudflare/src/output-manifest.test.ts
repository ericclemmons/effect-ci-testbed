import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, symlinkSync, unlinkSync, truncateSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { outputManifestCommand, outputManifestDigest, parseOutputManifest } from "./output-manifest.ts"

test("snapshot output identity comes from selected real bytes and modes, not snapshot or build IDs", async () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-output-manifest-"))
  try {
    for (const name of ["first", "rebuilt"]) {
      mkdirSync(join(root, name, "dist/nested"), { recursive: true })
      writeFileSync(join(root, name, "dist/index.html"), "<h1>same output</h1>")
      writeFileSync(join(root, name, "dist/nested/image.bin"), new Uint8Array([0, 255, 10]))
      writeFileSync(join(root, name, "source.txt"), name)
    }
    const read = (name: string) => {
      const [binary, ...args] = outputManifestCommand(["dist/**"])
      return parseOutputManifest(execFileSync(binary!, args, { cwd: join(root, name), encoding: "utf8" }), ["dist/**"])
    }
    const first = read("first"), rebuilt = read("rebuilt")
    assert.deepEqual(first.files.map(file => file.path), ["dist/index.html", "dist/nested/image.bin"])
    assert.equal(await outputManifestDigest(first), await outputManifestDigest(rebuilt))
    writeFileSync(join(root, "rebuilt/dist/index.html"), "<h1>shared package changed this output</h1>")
    assert.notEqual(await outputManifestDigest(first), await outputManifestDigest(read("rebuilt")))
    chmodSync(join(root, "first/dist/index.html"), 0o755)
    assert.notEqual(await outputManifestDigest(first), await outputManifestDigest(read("first")))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("output inspection rejects links, oversized files and unowned manifest paths", () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-output-invalid-"))
  try {
    mkdirSync(join(root, "dist"))
    writeFileSync(join(root, "outside.txt"), "not selected")
    symlinkSync(join(root, "outside.txt"), join(root, "dist/link"))
    const [binary, ...args] = outputManifestCommand(["dist/**"])
    const read = () => execFileSync(binary!, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    assert.throws(read)
    unlinkSync(join(root, "dist/link"))
    writeFileSync(join(root, "dist/large"), "")
    truncateSync(join(root, "dist/large"), 17 * 1024 * 1024)
    assert.throws(read)
    assert.throws(() => outputManifestCommand(["../outside"]))
    const file = { path: "dist/app.js", size: 1, sha256: "a".repeat(64), executable: false }
    for (const files of [[file, file], [{ ...file, path: "elsewhere/app.js" }], [{ ...file, path: "../escape" }]])
      assert.throws(() => parseOutputManifest(JSON.stringify({ version: 1, patterns: ["dist/**"], files }), ["dist/**"]))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
