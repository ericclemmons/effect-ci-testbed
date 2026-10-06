import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

const bin = fileURLToPath(new URL("./bin.ts", import.meta.url))
const repository = fileURLToPath(new URL("../../../", import.meta.url))
const example = fileURLToPath(new URL("../../../examples/exported-actions/", import.meta.url))
const zeroConfig = fileURLToPath(new URL("../../../examples/zero-config/", import.meta.url))

const run = (args: ReadonlyArray<string>, cwd: string = repository) =>
  spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
  })

test("discovers workflow.ts and actions.ts from the current project", () => {
  const result = run(["list", "--format=json"], example)

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout) as {
    readonly targets: ReadonlyArray<string>
    readonly workflow: string
  }
  assert.equal(output.workflow, "exported-actions")
  assert.deepEqual(output.targets, ["check"])
})

test("accepts an explicit workflow path and plans one sibling action", () => {
  const result = run([
    "plan",
    "examples/exported-actions/.cloudflare/ci/workflow.ts",
    "check",
    "--format=json",
  ])

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout) as {
    readonly target: string
    readonly plan: { readonly nodes: ReadonlyArray<{ readonly id: string }> }
  }
  assert.equal(output.target, "check")
  assert.equal(output.plan.nodes.at(-1)?.id, "check")
})

test("rejects an action that the workflow does not export", () => {
  const result = run(["run", "checkout", "--format=json"], example)

  assert.equal(result.status, 2, result.stderr)
  const output = JSON.parse(result.stdout) as {
    readonly error: {
      readonly code: string
      readonly details: { readonly available: ReadonlyArray<string> }
    }
  }
  assert.equal(output.error.code, "CI_UNKNOWN_TARGET")
  assert.deepEqual(output.error.details.available, ["check"])
})

test("renders the planned action graph as Mermaid", () => {
  const result = run(["plan", "--format=mermaid"], example)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^flowchart LR/m)
  assert.match(result.stdout, /step_checkout --> step_check/)
})

test("an empty ci.ts infers conventional package scripts", () => {
  const listed = run(["list", "--format=json"], zeroConfig)

  assert.equal(listed.status, 0, listed.stderr)
  const output = JSON.parse(listed.stdout) as {
    readonly targets: ReadonlyArray<string>
    readonly workflow: string
  }
  assert.equal(output.workflow, "effect-ci-zero-config-fixture")
  assert.deepEqual(output.targets, ["build", "format", "lint", "test"])

  const planned = run(["plan", "--format=mermaid"], zeroConfig)
  assert.equal(planned.status, 0, planned.stderr)
  assert.match(planned.stdout, /step_checkout --> step_install/)
  assert.match(planned.stdout, /step_test --> step_build/)
})
