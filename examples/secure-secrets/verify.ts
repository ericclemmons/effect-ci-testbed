import assert from "node:assert/strict"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"

const authenticate = CI.action<Redacted.Redacted<string>>(
  "authenticate registry",
  () => function* () {
    return yield* CI.Secret("REGISTRY_TOKEN")
  },
)

const workflow = CI.workflow("secure-secrets", () => authenticate())
const planned = await CI.runPromise(workflow, { mode: "plan", output: "silent" })

assert.deepEqual(planned.plan.nodes[0]?.secrets, ["REGISTRY_TOKEN"])

const secret = "never-print-this-value"
const executed = await CI.runPromise(workflow, {
  output: "silent",
  secrets: {
    resolve: (name) => Effect.succeed(Redacted.make(secret, { label: name })),
  },
})

assert.equal(String(executed.value), "<redacted:REGISTRY_TOKEN>")
assert.doesNotMatch(JSON.stringify(executed), new RegExp(secret))

const missing = CI.action<Redacted.Redacted<string>>("missing secret", () => function* () {
  return yield* CI.Secret("EFFECT_CI_TEST_MISSING_SECRET")
})

await assert.rejects(
  CI.runPromise(CI.workflow("missing-secret", () => missing()), { output: "silent" }),
  (error) => error instanceof CI.SecretError &&
    error.secret === "EFFECT_CI_TEST_MISSING_SECRET",
)

console.log("secure secret resolution passed")
