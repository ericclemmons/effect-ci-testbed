import assert from "node:assert/strict"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

import workflow from "../workflow.ts"

const planned = await CI.runPromise(workflow, { mode: "plan", output: "silent" })

assert.equal(
  planned.plan.nodes.find((node) => node.id === "redeploy previous version")?.rollbackFor,
  "deploy with retries",
)

let deployments = 0
let rollbacks = 0
const executor: CI.CommandExecutor = {
  execute: ({ command, stepId, workspace }) => {
    if (command === "echo deploy") {
      deployments++

      return Effect.fail(new CI.CommandError(stepId, command, workspace.cwd, 1))
    }

    rollbacks++

    return Effect.succeed({ exitCode: 0, stderr: "", stdout: "" })
  },
}

await assert.rejects(
  CI.runPromise(workflow, { executor, output: "silent" }),
  (error) => error instanceof CI.CommandError,
)

assert.equal(deployments, 3)
assert.equal(rollbacks, 1)

const failedRollback = CI.action<void>("failed rollback", () => () =>
  Effect.fail(new Error("rollback failed")))
const failedDeployWithRollback = CI.action<void>(
  "failed deployment with rollback",
  () => () => Effect.fail(new Error("deployment failed")),
  { rollback: failedRollback },
)
const doublyFailed = CI.workflow("failed-compensation", () =>
  failedDeployWithRollback())

await assert.rejects(
  CI.runPromise(doublyFailed, { output: "silent" }),
  (error) => error instanceof CI.RollbackError &&
    error.original instanceof Error && error.original.message === "deployment failed" &&
    error.rollback instanceof Error && error.rollback.message === "rollback failed",
)

const unwindOrder: Array<string> = []
const firstRollback = CI.action<void>("rollback first completed action", () => () =>
  Effect.sync(() => {
    unwindOrder.push("first")
  }))
const first = CI.action<void>(
  "first completed action",
  () => () => Effect.void,
  { rollback: firstRollback },
)
const secondRollback = CI.action<void>("rollback second completed action", () => () =>
  Effect.sync(() => {
    unwindOrder.push("second")
  }))
const second = CI.action<void>(
  "second completed action",
  () => function* () {
    yield* first()
  },
  { rollback: secondRollback },
)
const failingCheck = CI.action<void>("failing post-deploy check", () => function* () {
  yield* second()
  return yield* Effect.fail(new Error("health check failed"))
})

await assert.rejects(
  CI.runPromise(
    CI.workflow("reverse-order-rollback", () => failingCheck()),
    { output: "silent" },
  ),
  /health check failed/,
)

assert.deepEqual(unwindOrder, ["second", "first"])
