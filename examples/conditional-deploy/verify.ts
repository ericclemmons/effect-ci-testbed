import assert from "node:assert/strict"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout(".")
})

const deploy = CI.action("deploy", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("deploy")
})

const production = CI.Condition.all(
  CI.Condition.event("push"),
  CI.Condition.ref("refs/heads/main"),
)

for (const type of ["pull_request", "push", "release"] as const) {
  for (const ref of ["refs/heads/main", "refs/heads/feature", "refs/tags/v1"] as const) {
    assert.equal(
      CI.matchesCondition(production, { type, ref }),
      type === "push" && ref === "refs/heads/main",
    )
  }
}

const workflow = CI.workflow("conditional-deploy", function* () {
  return yield* CI.when(production, deploy())
})

const planned = await CI.runPromise(workflow, {
  event: { type: "pull_request", ref: "refs/pull/1/merge" },
  mode: "plan",
  output: "silent",
})

assert.deepEqual(planned.plan.nodes.find((node) => node.id === "deploy")?.condition, production)
assert.match(CI.formatPlan(planned.plan), /if: event in \[push\] and ref in \[refs\/heads\/main\]/)

let executions = 0
const executor: CI.CommandExecutor = {
  execute: () => {
    executions++
    return Effect.succeed({ exitCode: 0, stderr: "", stdout: "" })
  },
}

const skipped = await CI.runPromise(workflow, {
  event: { type: "pull_request", ref: "refs/pull/1/merge" },
  executor,
  output: "silent",
})

assert.equal(executions, 0)
assert.equal(skipped.plan.nodes.find((node) => node.id === "deploy")?.status, "skipped")

await CI.runPromise(workflow, {
  event: { type: "push", ref: "refs/heads/main" },
  executor,
  output: "silent",
})

assert.equal(executions, 1)
console.log("inspectable conditions passed")
