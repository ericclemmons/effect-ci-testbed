import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { NonRetryableError } from "cloudflare:workflows"
import { slow } from "../../../examples/execution-policy/.cloudflare/ci/actions.ts"

const exhausted = CI.action<void>("exhausted", () => () => Effect.fail(new Error("expected-effect-exhaustion")), {
  retries: { limit: 2, delay: 0, backoff: "constant" },
})
const rejected = CI.action<void>("non-retryable", () => () => Effect.fail(new NonRetryableError("expected-terminal-policy-error")), {
  retries: { limit: 10, delay: 0, backoff: "constant" },
})

export const timeoutProbe = CI.workflow("effect-timeout", () => slow())
export const exhaustionProbe = CI.workflow("effect-exhaustion", () => exhausted())
export const nonRetryableProbe = CI.workflow("effect-terminal", () => rejected())
