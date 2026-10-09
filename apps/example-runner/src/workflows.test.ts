import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"

import nodeNpm from "../../../examples/node-npm/.cloudflare/ci/workflow.ts"
import nodePnpm from "../../../examples/node-pnpm/.cloudflare/ci/workflow.ts"
import optionalChecks from "../../../examples/optional-checks/.cloudflare/ci/workflow.ts"
import workspace from "../../../examples/cloudflare-runner/.cloudflare/ci/workflow.ts"
import pythonToolchain from "../../../examples/cloudflare-toolchain/.cloudflare/ci/workflow.ts"
import systemPackage from "../../../examples/system-package/.cloudflare/ci/workflow.ts"
import vitePlusCache from "../../../examples/vite-plus-cache/.cloudflare/ci/workflow.ts"
import turborepoCache from "../../../examples/turborepo-cache/.cloudflare/ci/workflow.ts"
import customRunnerImage from "../../../examples/custom-runner-image/.cloudflare/ci/workflow.ts"

for (const [name, workflow, expected] of [
  ["npm", nodeNpm, ["checkout", "install", "lint", "test", "build"]],
  ["pnpm", nodePnpm, ["checkout", "install", "lint", "format", "test", "build"]],
  ["optional checks", optionalChecks, ["checkout", "install", "lint", "format"]],
  ["workspace", workspace, ["checkout", "install", "build"]],
  ["python toolchain", pythonToolchain, ["checkout", "prepare python toolchain", "build python package"]],
  ["system package", systemPackage, ["checkout", "install imagemagick", "verify imagemagick"]],
  ["Vite+ cache", vitePlusCache, ["checkout", "install", "build"]],
  ["Turborepo cache", turborepoCache, ["checkout", "install", "build"]],
  ["custom runner image", customRunnerImage, ["checkout", "verify baked-in python"]],
] as const) {
  test(`${name} uses the unchanged consumer workflow`, async () => {
    const result = await CI.runPromise<unknown>(workflow, {
      mode: "plan",
      output: "silent",
      event: { type: "workflow_dispatch" },
    })

    assert.deepEqual(result.plan.nodes.map((node) => node.id).sort(), [...expected].sort())
    assert.ok(result.plan.nodes.every((node) => node.status === "planned"))
  })
}

test("optional validation checks do not publish unnecessary workspace revisions", async () => {
  const result = await CI.runPromise(optionalChecks, { mode: "plan", output: "silent" })
  assert.equal(result.outputs.lint, undefined)
  assert.equal(result.outputs.format, undefined)
})

test("different workflows can run concurrently with the same action name", async () => {
  const left = CI.action<void>("shared", () => function* () {}, { timeout: 100 })
  const right = CI.action<void>("shared", () => function* () {}, { timeout: 200 })
  const options = { mode: "plan", output: "silent" } as const
  const results = await Promise.all([
    CI.runPromise(CI.workflow("left", () => left()), options),
    CI.runPromise(CI.workflow("right", () => right()), options),
    CI.runPromise(CI.workflow("left-again", () => left()), options),
  ])

  assert.deepEqual(results.map((result) => result.plan.nodes[0]!.options.timeout), [100, 200, 100])
})

test("different actions with the same name still fail within one workflow", async () => {
  const left = CI.action<void>("duplicate", () => function* () {})
  const right = CI.action<void>("duplicate", () => function* () {})
  const workflow = CI.workflow("duplicates", function* () {
    yield* left()
    yield* right()
  })

  await assert.rejects(
    CI.runPromise(workflow, { mode: "plan", output: "silent" }),
    /Duplicate CI action id: duplicate/,
  )
})

test("action arguments are scoped to each run, not the lifetime of the Worker", async () => {
  const target = CI.action<string, readonly [string]>("target", () => function* (value) {
    return value
  })
  const options = { output: "silent" } as const
  const first = await CI.runPromise(CI.workflow("first", () => target("warm")), options)
  const second = await CI.runPromise(CI.workflow("second", () => target("offline")), options)
  assert.equal(first.value, "warm")
  assert.equal(second.value, "offline")

  const parallel = await Promise.all([
    CI.runPromise(CI.workflow("third", () => target("left")), options),
    CI.runPromise(CI.workflow("fourth", () => target("right")), options),
  ])
  assert.deepEqual(parallel.map((result) => result.value), ["left", "right"])
})

test("one action still executes only once per workflow", async () => {
  let executions = 0
  const target = CI.action<string, readonly [string]>("memoized", () => function* (value) {
    executions++
    return value
  })
  const result = await CI.runPromise(CI.workflow("memoization", function* () {
    const first = yield* target("first")
    const second = yield* target("second")
    return [first, second]
  }), { output: "silent" })
  assert.deepEqual(result.value, ["first", "first"])
  assert.equal(executions, 1)
})
