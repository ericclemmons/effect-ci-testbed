import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { cachedAccessToken, readRemoteProfile } from "./remote-auth.ts"

test("private machine profiles select only the exact enrolled repository", () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-profile-"))
  const path = join(root, "remotes.json")
  try {
    assert.equal(readRemoteProfile("https://github.com/owner/repo.git", path), undefined)
    writeFileSync(path, JSON.stringify({ version: 1, remotes: [{
      repository: "https://github.com/owner/repo", url: "https://ci.example/demo", token: "private-api-token",
    }] }), { mode: 0o600 })
    assert.deepEqual(readRemoteProfile("https://github.com/owner/repo.git", path), {
      url: "https://ci.example/demo", token: "private-api-token",
    })
    assert.equal(readRemoteProfile("https://github.com/other/repo.git", path), undefined)
    if (process.platform !== "win32") {
      chmodSync(path, 0o644)
      assert.throws(() => readRemoteProfile("https://github.com/owner/repo", path), /private/)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("cached Access lookup is origin-bound, bounded and never treats failure as login", () => {
  let reads = 0
  const read = (origin: string) => {
    reads++
    assert.equal(origin, "https://ci.example")
    return "header.payload.signature\n"
  }
  assert.equal(cachedAccessToken("https://ci.example/demo", read), "header.payload.signature")
  assert.equal(cachedAccessToken("http://127.0.0.1:1234", read), undefined)
  assert.equal(reads, 1)
  assert.equal(cachedAccessToken("https://ci.example", () => "not a JWT"), undefined)
  assert.equal(cachedAccessToken("https://ci.example", () => { throw new Error("private output") }), undefined)
  assert.throws(() => cachedAccessToken("https://user:secret@ci.example", read), /HTTPS/)
})
