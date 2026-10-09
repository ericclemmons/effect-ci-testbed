import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"

import nodeNpm from "../../../examples/node-npm/.cloudflare/ci/workflow.ts"
import nodePnpm from "../../../examples/node-pnpm/.cloudflare/ci/workflow.ts"
import optionalChecks from "../../../examples/optional-checks/.cloudflare/ci/workflow.ts"
import workspace from "../../../examples/cloudflare-runner/.cloudflare/ci/workflow.ts"

for (const [name, workflow, expected] of [
  ["npm", nodeNpm, ["checkout", "install", "lint", "test", "build"]],
  ["pnpm", nodePnpm, ["checkout", "install", "lint", "format", "test", "build"]],
  ["optional checks", optionalChecks, ["checkout", "install", "lint", "format"]],
  ["workspace", workspace, ["checkout", "install", "build"]],
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
