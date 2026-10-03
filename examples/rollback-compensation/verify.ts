import assert from "node:assert/strict"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

const checkout = CI.action("checkout for compensation", function* () {
  const source = yield* CI.Source

  return () => source.checkout(".")
})

const deploy = CI.action("deploy with retries", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("deploy")
}, {
  retries: { limit: 2, delay: 0 },
})

const rollback = CI.action("redeploy previous version", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("rollback")
})

const workflow = CI.workflow("rollback-compensation", function* () {
  return yield* CI.compensate(deploy(), rollback())
})

const planned = await CI.runPromise(workflow, { mode: "plan", output: "silent" })
assert.equal(
  planned.plan.nodes.find((node) => node.id === "redeploy previous version")?.compensationFor,
  "deploy with retries",
)

let deployments = 0
let rollbacks = 0
const executor: CI.CommandExecutor = {
  execute: ({ command, stepId, workspace }) => {
    if (command === "deploy") {
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

const failedDeploy = CI.action<void>("failed deployment", () => () =>
  Effect.fail(new Error("deployment failed")))
const failedRollback = CI.action<void>("failed rollback", () => () =>
  Effect.fail(new Error("rollback failed")))
const doublyFailed = CI.workflow("failed-compensation", () =>
  CI.compensate(failedDeploy(), failedRollback()))

await assert.rejects(
  CI.runPromise(doublyFailed, { output: "silent" }),
  (error) => error instanceof CI.CompensationError &&
    error.original instanceof Error && error.original.message === "deployment failed" &&
    error.compensation instanceof Error && error.compensation.message === "rollback failed",
)

console.log("durable compensation passed")
