import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { readProjectRemote, resolveRemote } from "./remote-config.ts"

test("fresh project loads its endpoint but never credentials or arbitrary environment", () => {
  const root = mkdtempSync(join(tmpdir(), "ci-remote-config-"))
  try {
    writeFileSync(join(root, ".env"), 'EFFECT_CI_REMOTE_URL="https://ci.example/demo"\nNODE_OPTIONS=never-load-this\n')
    assert.deepEqual(readProjectRemote(root), { url: "https://ci.example/demo" })
    assert.equal(process.env.NODE_OPTIONS === "never-load-this", false)
    writeFileSync(join(root, ".env.local"), "EFFECT_CI_REMOTE_URL=https://local.example/demo\n", { mode: 0o600 })
    const project = readProjectRemote(root)
    assert.deepEqual(resolveRemote({}, undefined, project), { url: "https://local.example/demo", token: undefined })
    assert.deepEqual(resolveRemote({ EFFECT_CI_REMOTE_URL: "https://other.example" }, undefined, project), { url: "https://other.example", token: undefined })
    writeFileSync(join(root, ".env.local"), "EFFECT_CI_REMOTE_TOKEN=must-not-enter-vite\n")
    assert.throws(() => readProjectRemote(root), /out of project/)
    writeFileSync(join(root, ".env"), "EFFECT_CI_REMOTE_TOKEN=must-not-be-shared\n")
    assert.throws(() => readProjectRemote(root), /out of project/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("explicit settings and private profile precede public project defaults", () => {
  const profile = { url: "https://private.example/demo", token: "profile-token" }
  const project = { url: "https://project.example/demo" }
  assert.deepEqual(resolveRemote({}, profile, project), profile)
  assert.deepEqual(resolveRemote({ EFFECT_CI_REMOTE_URL: "https://override.example", EFFECT_CI_REMOTE_TOKEN: "explicit" }, profile, project), { url: "https://override.example", token: "explicit" })
})
