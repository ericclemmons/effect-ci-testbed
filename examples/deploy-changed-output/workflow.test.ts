import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

test("standalone CLI publishes only changed output, including a shared-only edit", () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-standalone-output-"))
  const bin = fileURLToPath(new URL("../../packages/cli/src/effect-ci.ts", import.meta.url))
  try {
    for (const directory of ["app", "packages"]) {
      cpSync(new URL(`./${directory}`, import.meta.url), join(root, directory), { recursive: true })
    }
    mkdirSync(join(root, ".cloudflare/ci"), { recursive: true })
    const workflow = join(root, ".cloudflare/ci/workflow.ts")
    writeFileSync(workflow, readFileSync(new URL("./.cloudflare/ci/workflow.ts", import.meta.url), "utf8")
      .replace('"@effect-ci-testbed/ci"', JSON.stringify(fileURLToPath(new URL("../../packages/ci/src/index.ts", import.meta.url))))
      .replace('"@effect-ci-testbed/ci/directory-deployment"', JSON.stringify(fileURLToPath(new URL("../../packages/ci/src/directory-deployment.ts", import.meta.url)))))
    const invoke = (command = "run", success = true) => {
      const result = spawnSync(process.execPath, [bin, command, "--workflow", workflow, "--format=json"], {
        cwd: root, encoding: "utf8", timeout: 20_000, env: { ...process.env, AI_AGENT: "test" },
      })
      if (!success) { assert.notEqual(result.status, 0); return [] }
      assert.equal(result.status, 0, result.stderr || result.stdout)
      return JSON.parse(result.stdout).plan.nodes.map((node: { id: string }) => node.id)
    }
    const current = join(root, ".effect-ci/deployments/site/current.json")
    invoke("plan")
    assert.equal(existsSync(current), false)
    assert.ok(invoke().includes("deploy"))
    const initial = readFileSync(current, "utf8")
    assert.ok(!invoke().includes("deploy"))
    assert.equal(readFileSync(current, "utf8"), initial)
    writeFileSync(join(root, "README.md"), "An unrelated documentation change")
    assert.ok(!invoke().includes("deploy"))
    const appSource = readFileSync(join(root, "app/src/page.mjs"), "utf8")
    writeFileSync(join(root, "packages/greeting/message.mjs"), 'export const message = "A shared change reaches the app."\n')
    assert.ok(invoke().includes("deploy"))
    assert.equal(readFileSync(join(root, "app/src/page.mjs"), "utf8"), appSource)
    assert.match(readFileSync(join(root, "app/dist/index.html"), "utf8"), /A shared change reaches the app/)
    assert.ok(!invoke().includes("deploy"))
    const successful = readFileSync(current, "utf8")
    writeFileSync(join(root, "packages/greeting/message.mjs"), 'throw new Error("broken shared dependency")\n')
    invoke("run", false)
    assert.equal(readFileSync(current, "utf8"), successful, "a failed build cannot advance deployment")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
