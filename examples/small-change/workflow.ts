import * as CI from "@effect-ci-testbed/ci"
import type * as Effect from "effect/Effect"

// The GitHub App supplies approval; the PR cannot choose its own policy.
export function approveSmallChanges<A, R>(approve: () => Effect.Effect<A, unknown, R>) {
  return CI.workflow("small-change", function* () {
    const source = yield* CI.Source
    if (!(yield* source.changed("**/*.(ts|tsx|json)"))) {
      return yield* approve()
    }
  })
}
