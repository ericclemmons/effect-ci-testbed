import assert from "node:assert/strict"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

let attempts = 0

const flaky = CI.action<void>("flaky", () => function* () {
  attempts++

  if (attempts < 3) {
    return yield* Effect.fail(new Error(`transient failure ${attempts}`))
  }
}, {
  retries: { limit: 2, delay: 0, backoff: "constant" },
})

const slow = CI.action<void>("slow", () => () =>
  Effect.sleep("100 millis").pipe(Effect.asVoid), {
  timeout: 5,
})

const checkout = CI.action("timeout checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout(".")
})

const hangingCommand = CI.action("hanging command", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("sleep 10")
}, {
  timeout: 25,
})

const retryWorkflow = CI.workflow("retry-policy", () => flaky())
const timeoutWorkflow = CI.workflow("timeout-policy", () => slow())

const retried = await CI.runPromise(retryWorkflow, { output: "silent" })

assert.equal(attempts, 3)
assert.equal(retried.plan.nodes[0]?.status, "complete")
assert.deepEqual(retried.plan.nodes[0]?.options, {
  retries: { limit: 2, delay: 0, backoff: "constant" },
})

await assert.rejects(
  CI.runPromise(timeoutWorkflow, { output: "silent" }),
  (error) => typeof error === "object" && error !== null,
)

const startedAt = Date.now()
await assert.rejects(
  CI.runPromise(CI.workflow("command-timeout", () => hangingCommand()), {
    output: "silent",
  }),
)
assert.ok(Date.now() - startedAt < 2_000, "timeout should interrupt the child process")

console.log("execution policy passed")
