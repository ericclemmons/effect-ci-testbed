import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

export const reusable = CI.check("reusable branch", () => function* () {
  yield* Effect.void
})

export const flaky = CI.check("flaky check", () => function* () {
  const attempt = yield* CI.Attempt
  if (attempt === 1) return yield* Effect.fail(new Error("Owned transient failure"))
}, { retries: { limit: 1, delay: 1, backoff: "constant" } })
