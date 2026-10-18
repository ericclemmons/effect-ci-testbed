import assert from "node:assert/strict"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

import workflow, { production } from "../workflow.ts"
import ifElse from "../if-else.ts"

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

// Source providers expose a complete comparison; ordinary if/else chooses the
// branch. These provider-boundary cases are not native hosted diff evidence.
for (const [paths, shouldDeploy] of [
  [["examples/conditional-deploy/index.html"], true],
  [["packages/ci/src/index.ts"], true],
  [["README.md"], false],
  [[], false],
] as const) {
  executions = 0
  const result = await CI.runPromise(ifElse, { executor, output: "silent", source: {
    changes: () => Effect.succeed({ status: "known", base: "a".repeat(40), head: "b".repeat(40), paths }),
    checkout: () => shouldDeploy
      ? Effect.succeed(CI.Workspace.local("/fixture"))
      : Effect.die("An unchanged project must not checkout"),
  } })
  assert.equal(executions, shouldDeploy ? 1 : 0)
  assert.equal(result.plan.nodes.some(node => node.id === "deploy"), shouldDeploy)
}
