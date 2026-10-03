import assert from "node:assert/strict"
import * as CI from "@effect-ci-testbed/ci"

import * as actions from "../actions.ts"
import workflow from "../workflow.ts"

actions.resetAttempts()
const retried = await CI.runPromise(workflow, { output: "silent" })

assert.equal(actions.attemptCount(), 3)
assert.equal(retried.plan.nodes[0]?.status, "complete")
assert.deepEqual(retried.plan.nodes[0]?.options, {
  retries: { limit: 2, delay: 0, backoff: "constant" },
})

await assert.rejects(
  CI.runPromise(CI.workflow("timeout-policy", () => actions.slow()), { output: "silent" }),
  (error) => typeof error === "object" && error !== null,
)

const startedAt = Date.now()

await assert.rejects(
  CI.runPromise(CI.workflow("command-timeout", () => actions.hangingCommand()), {
    output: "silent",
  }),
)

assert.ok(Date.now() - startedAt < 2_000, "timeout should interrupt the child process")
