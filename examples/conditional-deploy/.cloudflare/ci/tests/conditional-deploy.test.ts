import assert from "node:assert/strict"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

import workflow, { production } from "../workflow.ts"

for (const type of ["pull_request", "push", "release"] as const) {
  for (const ref of ["refs/heads/main", "refs/heads/feature", "refs/tags/v1"] as const) {
    assert.equal(
      CI.matchesCondition(production, { type, ref }),
      type === "push" && ref === "refs/heads/main",
    )
  }
}

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
