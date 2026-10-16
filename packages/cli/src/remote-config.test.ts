import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { readProjectRemote, resolveRemote } from "./remote-config.ts"

test("fresh project loads its public endpoint; local credentials stay private and origin-bound", () => {
  const root = mkdtempSync(join(tmpdir(), "ci-remote-config-"))
  try {
    writeFileSync(join(root, ".env"), 'EFFECT_CI_REMOTE_URL="https://ci.example/demo"\nNODE_OPTIONS=never-load-this\n')
    assert.deepEqual(readProjectRemote(root), { url: "https://ci.example/demo" })
    assert.equal(process.env.NODE_OPTIONS === "never-load-this", false)
    writeFileSync(join(root, ".env.local"), "EFFECT_CI_REMOTE_TOKEN=private-fixture-token\n", { mode: 0o600 })
    const project = readProjectRemote(root)
    assert.deepEqual(resolveRemote({}, undefined, project), { url: "https://ci.example/demo", token: "private-fixture-token" })
    assert.deepEqual(resolveRemote({ EFFECT_CI_REMOTE_URL: "https://other.example" }, undefined, project), { url: "https://other.example", token: undefined })
    if (process.platform !== "win32") {
      chmodSync(join(root, ".env.local"), 0o644)
      assert.throws(() => readProjectRemote(root), /private/)
    }
    writeFileSync(join(root, ".env"), "EFFECT_CI_REMOTE_TOKEN=must-not-be-shared\n")
    assert.throws(() => readProjectRemote(root), /private/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("explicit settings and private profile precede public project defaults", () => {
  const profile = { url: "https://private.example/demo", token: "profile-token" }
  const project = { url: "https://project.example/demo", token: "project-token" }
  assert.deepEqual(resolveRemote({}, profile, project), profile)
  assert.deepEqual(resolveRemote({ EFFECT_CI_REMOTE_URL: "https://override.example", EFFECT_CI_REMOTE_TOKEN: "explicit" }, profile, project), { url: "https://override.example", token: "explicit" })
})
