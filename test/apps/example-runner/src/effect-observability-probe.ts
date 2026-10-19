import * as CI from "@effect-ci-testbed/ci"
import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as Effect from "effect/Effect"
import { NonRetryableError } from "cloudflare:workflows"

// Administrative probe, no Slack notification and no health denominator.
export const EffectObservabilityWorkflow = Cloudflare.workflowEntrypoint(() => {
  const action = CI.action<string>("structured-logs", () => () => Effect.gen(function* () {
    const attempt = yield* CI.Attempt
    yield* Effect.logInfo("effect-wobs-probe", { attempt, metric: "diagnostic-only" })
    yield* Effect.logWarning("effect-wobs-warning")
    if (attempt === 1) return yield* Effect.fail(new Error("effect-wobs-retry"))
    yield* Effect.logError(new Error("effect-wobs-handled-error"))
    return "logged"
  }), { retries: { limit: 1, delay: "1 second", backoff: "constant" } })
  return Promise.resolve(CI.workflow("effect-observability", () => action()))
})

const terminal = CI.action("terminal-error", () => () => Effect.fail(new NonRetryableError("effect-wobs-terminal")),
  { retries: { limit: 10, delay: "1 second", backoff: "constant" } })
export const EffectObservabilityTerminalWorkflow = Cloudflare.workflowEntrypoint(CI.workflow("effect-observability-terminal", () => terminal()))
