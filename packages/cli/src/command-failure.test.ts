import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { main } from "./index.ts"

const failedCommand = (script: string, check: (output: any) => void) => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-failure-"))
  const ci = fileURLToPath(new URL("../../ci/src/index.ts", import.meta.url))
  const bin = fileURLToPath(new URL("./effect-ci.ts", import.meta.url))
  try {
    writeFileSync(join(root, "failure.mjs"), `import{appendFileSync}from'node:fs';appendFileSync('calls.txt','once\\n');${script};process.exitCode=7;`)
    writeFileSync(join(root, "workflow.ts"), `import * as CI from ${JSON.stringify(ci)};
      const checkout=CI.action('checkout',function*(){const source=yield*CI.Source;return()=>source.checkout()});
      const check=CI.action('check',()=>function*(){const w=yield*checkout();return yield*w.exec('node failure.mjs')},{retries:{limit:0,delay:'1 second'}});
      export default CI.workflow('failure-fixture',()=>check());`)
    const result = spawnSync(process.execPath, [bin, "run", "--workflow", join(root, "workflow.ts")], {
      cwd: root, encoding: "utf8", timeout: 15000, env: { ...process.env, AI_AGENT: "test" },
    })
    assert.equal(result.status, 1, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.error.code, "CI_COMMAND_FAILED")
    assert.equal(output.error.details.exitCode, 7)
    assert.equal(output.error.details.stepId, "check")
    check(output.error.details.output)
    assert.equal(readFileSync(join(root, "calls.txt"), "utf8"), "once\n")
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("agent JSON retains both failed-command streams without rerunning it", () => {
  failedCommand("console.log('compiler context');console.error('diagnostic: missing export')", output => {
    assert.deepEqual(output, { stdout: "compiler context\n", stderr: "diagnostic: missing export\n", truncated: false })
  })
})

test("agent failed-command output is bounded and explicitly marks retained tails", () => {
  failedCommand("process.stdout.write('x'.repeat(40000)+'stdout-tail');process.stderr.write('y'.repeat(40000)+'stderr-tail')", output => {
    assert.equal(output.stdout.length, 32768)
    assert.equal(output.stderr.length, 32768)
    assert.ok(output.stdout.endsWith('stdout-tail'))
    assert.ok(output.stderr.endsWith('stderr-tail'))
    assert.equal(output.truncated, true)
  })
})

test("agent JSON distinguishes checkpoint uncertainty from a verified process exit", async () => {
  const writes: string[] = [], original = process.stdout.write
  process.stdout.write = ((value: string | Uint8Array) => { writes.push(String(value)); return true }) as typeof process.stdout.write
  try {
    const workflow = CI.workflow("unknown-command-fixture", () => Effect.fail(new CI.CommandCheckpointError("install", "pnpm install", "/workspace")))
    const code = await main({ workflow }, ["run", "--format=json"])
    assert.equal(code, 1, "CLI failure is not an observed child exit 1")
    const value = JSON.parse(writes.join(""))
    assert.equal(value.ok, false)
    assert.equal(value.error.code, "CI_COMMAND_OUTCOME_UNKNOWN")
    assert.deepEqual(value.error.details, { command: "pnpm install", cwd: "/workspace", stepId: "install",
      stage: "checkpoint-ack", processExitCode: null, effects: "unknown" })
    assert.equal("exitCode" in value.error.details, false)
    assert.equal("output" in value.error.details, false)
  } finally { process.stdout.write = original }
})

test("agent JSON does not invent an exit code for a missing container result", async () => {
  const writes: string[] = [], original = process.stdout.write
  process.stdout.write = ((value: string | Uint8Array) => { writes.push(String(value)); return true }) as typeof process.stdout.write
  try {
    const workflow = CI.workflow("unknown-container-fixture", () => Effect.fail(new CI.CommandExecutionError("test", "node --test", "/workspace")))
    assert.equal(await main({ workflow }, ["run", "--format=json"]), 1)
    const value = JSON.parse(writes.join(""))
    assert.equal(value.error.code, "CI_COMMAND_OUTCOME_UNKNOWN")
    assert.deepEqual(value.error.details, { command: "node --test", cwd: "/workspace", stepId: "test",
      stage: "container-execution", processExitCode: null, effects: "unknown" })
    assert.equal("exitCode" in value.error.details, false)
    assert.equal("output" in value.error.details, false)
  } finally { process.stdout.write = original }
})
