import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { initializeJavaScriptProject } from "./index.ts"

const fixture = (body: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), "ci-bootstrap-"))
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "bootstrap-fixture", version: "0.0.0", scripts: {
      lint: `node -e "require('fs').writeFileSync('checked.txt','ok')"`,
    } }))
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "bootstrap-fixture", version: "0.0.0",
      lockfileVersion: 3, packages: { "": { name: "bootstrap-fixture", version: "0.0.0" } } }))
    body(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("explicit local run creates one empty marker and actually executes the inferred check", () => fixture(root => {
  const bin = fileURLToPath(new URL("./bin.ts", import.meta.url))
  const result = spawnSync(process.execPath, [bin, "run", "lint", "--format=text"], {
    cwd: root, encoding: "utf8", timeout: 30_000,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(join(root, ".cloudflare/ci/ci.ts"), "utf8"), "")
  assert.equal(readFileSync(join(root, "checked.txt"), "utf8"), "ok")
  assert.equal(initializeJavaScriptProject(["run"], root), undefined)
  const listed = spawnSync(process.execPath, [bin, "list", "--format=json"], { cwd: root, encoding: "utf8" })
  assert.equal(listed.status, 0, listed.stderr)
  assert.deepEqual(JSON.parse(listed.stdout).targets, ["lint"])
}))

test("plan, list, remote and explicit paths never initialize", () => fixture(root => {
  for (const args of [["plan"], ["list"], ["run", "--remote"], ["run", "--workflow", "missing.ts"]]) {
    assert.equal(initializeJavaScriptProject(args, root), undefined)
    assert.equal(existsSync(join(root, ".cloudflare")), false)
  }
}))

test("unknown targets and packages with no conventional tasks fail before writing", () => fixture(root => {
  assert.throws(() => initializeJavaScriptProject(["run", "unknown"], root), /Unknown action target/)
  assert.equal(existsSync(join(root, ".cloudflare")), false)
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { start: "do-not-run" } }))
  assert.throws(() => initializeJavaScriptProject(["run"], root), /no format/)
  assert.equal(existsSync(join(root, ".cloudflare")), false)
}))

test("an existing workflow wins and is never overwritten", () => fixture(root => {
  mkdirSync(join(root, ".cloudflare/ci"), { recursive: true })
  writeFileSync(join(root, ".cloudflare/ci/workflow.ts"), "existing workflow")
  assert.equal(initializeJavaScriptProject(["run"], root), undefined)
  assert.equal(existsSync(join(root, ".cloudflare/ci/ci.ts")), false)
  assert.equal(readFileSync(join(root, ".cloudflare/ci/workflow.ts"), "utf8"), "existing workflow")
}))

test("symlinked configuration directories cannot redirect initialization", () => fixture(root => {
  const outside = mkdtempSync(join(tmpdir(), "ci-bootstrap-outside-"))
  try {
    symlinkSync(outside, join(root, ".cloudflare"))
    assert.throws(() => initializeJavaScriptProject(["run"], root), /ordinary project-owned/)
    assert.equal(existsSync(join(outside, "ci")), false)
  } finally { rmSync(outside, { recursive: true, force: true }) }
}))
