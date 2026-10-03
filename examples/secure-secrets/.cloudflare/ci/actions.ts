import * as CI from "@effect-ci-testbed/ci"
import * as Redacted from "effect/Redacted"

export const authenticate = CI.action<Redacted.Redacted<string>>(
  "authenticate registry",
  () => function* () {
    return yield* CI.Secret("GITHUB_TOKEN")
  },
)
