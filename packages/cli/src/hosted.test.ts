import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

test("the hosted CLI discovers a fresh project's authored workflow without linking an SDK into the project", () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-authored-project-"))
  try {
    mkdirSync(join(root, ".cloudflare/ci"), { recursive: true })
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, ".cloudflare/ci/workflow.ts"), `
      import * as CI from "@effect-ci-testbed/ci";
      export const releaseNotes = CI.action("write release notes", () => function* () {
        const source = yield* CI.Source;
        const workspace = yield* source.checkout();
        return yield* workspace.exec(${JSON.stringify('node -e "require(\'node:fs\').writeFileSync(\'notes.txt\',\'authored\')"')});
      });
      export default CI.workflow("conference", () => releaseNotes());
    `)
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("hosted.ts", import.meta.url)), "run", "--local", "--format=json",
    ], { cwd: root, encoding: "utf8", timeout: 20_000, env: { PATH: process.env.PATH } })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.workflow, "conference")
    assert.deepEqual(output.plan.nodes.map((node: { id: string }) => node.id), ["write release notes"])
    assert.equal(readFileSync(join(root, "notes.txt"), "utf8"), "authored")
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), '{"type":"module"}')
    assert.equal(existsSync(join(root, "node_modules")), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("hosted planning doesn't execute commands and a failed authored command isn't replayed", () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-authored-failure-"))
  try {
    mkdirSync(join(root, ".cloudflare/ci"), { recursive: true })
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, ".cloudflare/ci/workflow.ts"), `
      import * as CI from "@effect-ci-testbed/ci";
      const fail = CI.action("fail once", () => function* () {
        const source = yield* CI.Source;
        return yield* (yield* source.checkout()).exec("printf attempted >> attempts.txt; exit 7");
      });
      export default CI.workflow("failed authored workflow", () => fail());
    `)
    const invoke = (command: string) => spawnSync(process.execPath, [
      fileURLToPath(new URL("hosted.ts", import.meta.url)), command, "--local", "--format=json",
    ], { cwd: root, encoding: "utf8", timeout: 20_000, env: { PATH: process.env.PATH } })
    const plan = invoke("plan")
    assert.equal(plan.status, 0, plan.stdout + plan.stderr)
    assert.equal(existsSync(join(root, "attempts.txt")), false)
    const failed = invoke("run")
    assert.equal(failed.status, 1, failed.stdout + failed.stderr)
    assert.equal(JSON.parse(failed.stdout).error.code, "CI_COMMAND_FAILED")
    assert.equal(readFileSync(join(root, "attempts.txt"), "utf8"), "attempted")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
