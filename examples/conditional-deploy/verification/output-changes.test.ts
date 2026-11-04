import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ci = fileURLToPath(new URL("../../../packages/ci/src/index.ts", import.meta.url))
const provider = fileURLToPath(new URL("../../../packages/ci/src/directory-deployment.ts", import.meta.url))
const bin = fileURLToPath(new URL("../../../packages/cli/src/effect-ci.ts", import.meta.url))

test("real CLI builds shared input and deploys only changed output across separate processes", () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-output-cli-"))
  try {
    cpSync(fileURLToPath(new URL("../outputs", import.meta.url)), join(root, "outputs"), { recursive: true })
    mkdirSync(join(root, ".cloudflare/ci"), { recursive: true })
    const body = readFileSync(new URL("../.cloudflare/ci/output-changes.ts", import.meta.url), "utf8")
      .replace('"@effect-ci-testbed/ci"', JSON.stringify(ci))
      .replace('"@effect-ci-testbed/ci/directory-deployment"', JSON.stringify(provider))
    const workflow = join(root, ".cloudflare/ci/output-changes.ts")
    writeFileSync(workflow, body)
    const invoke = (command = "run") => {
      const result = spawnSync(process.execPath, [bin, command, "--workflow", workflow, "--format=json"], {
        cwd: root, encoding: "utf8", timeout: 15_000, env: { ...process.env, AI_AGENT: "test" },
      })
      assert.equal(result.status, 0, result.stderr || result.stdout)
      return JSON.parse(result.stdout).plan.nodes.map((node: { id: string }) => node.id)
    }
    invoke("plan")
    assert.equal(existsSync(join(root, ".effect-ci/deployments")), false, "planning cannot publish or establish a baseline")
    assert.ok(invoke().includes("deploy"))
    assert.ok(!invoke().includes("deploy"), "a new CLI process reads persisted successful deployment")
    const app = readFileSync(join(root, "outputs/app.mjs"), "utf8")
    writeFileSync(join(root, "outputs/shared/message.mjs"), 'export const message = "changed shared package";')
    assert.ok(invoke().includes("deploy"))
    assert.equal(readFileSync(join(root, "outputs/app.mjs"), "utf8"), app)
    assert.ok(!invoke().includes("deploy"))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
