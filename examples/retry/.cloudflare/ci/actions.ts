import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

export const flaky = CI.check("flaky test", () => function* () {
  const attempt = yield* CI.Attempt
  if (attempt === 1) {
    return yield* Effect.fail(new Error("Simulated transient failure on attempt 1"))
  }
}, {
  retries: { limit: 1, delay: 1000, backoff: "constant" },
})
