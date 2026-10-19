import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"

/** Explicit host-only canary mapping; never falls back to unrelated credentials. */
export const demoSecretResolver = (value?: string): CI.SecretResolver => ({
  resolve: name => name === "GITHUB_TOKEN" && value
    ? Effect.succeed(Redacted.make(value)) : Effect.fail(new CI.SecretError(name)),
})
