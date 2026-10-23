import assert from "node:assert/strict"
import * as CI from "@effect-ci-testbed/ci"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as TestClock from "effect/testing/TestClock"

import * as actions from "../actions.ts"
import workflow from "../workflow.ts"

actions.resetAttempts()
const retried = await CI.runPromise(workflow, { output: "silent" })

assert.equal(actions.attemptCount(), 3)
assert.equal(retried.plan.nodes[0]?.status, "complete")
assert.deepEqual(retried.plan.nodes[0]?.options, {
  retries: { limit: 2, delay: 0, backoff: "constant" },
})

// Exercise the SDK's linear schedule with virtual time, including its first delay.
const retryTimes: number[] = []
const linear = CI.action<void>("linear retry", () => function* () {
  retryTimes.push(yield* Clock.currentTimeMillis)
  if ((yield* CI.Attempt) < 4) return yield* Effect.fail(new Error("retry"))
}, { retries: { limit: 3, delay: 100, backoff: "linear" } })
await Effect.runPromise(Effect.gen(function* () {
  const fiber = yield* CI.run(CI.workflow("linear-policy", () => linear()), {
    output: "silent",
  }).pipe(Effect.forkChild)
  yield* TestClock.adjust(600)
  yield* Fiber.join(fiber)
}).pipe(Effect.provide(TestClock.layer())))
assert.deepEqual(retryTimes.map((time) => time - retryTimes[0]!), [0, 100, 300, 600])

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
