import * as Effect from "effect/Effect"
import * as Logger from "effect/Logger"
import * as Redacted from "effect/Redacted"
import { CurrentLogAnnotations } from "effect/References"

type Sink = Pick<Console, "debug" | "info" | "warn" | "error">
export interface WobsContext { readonly workflow: string; readonly instance: string }

/** Trusted host logging only: never forwards container output or environment objects. */
export const wobsLoggerLayer = (context: WobsContext, environment: object = {}, sink: Sink = console) => {
  let secrets: string[] = []
  let inventoryAvailable = true
  let suppressionReported = false
  try {
    const sensitive = Object.entries(Object.getOwnPropertyDescriptors(environment))
      .filter(([key]) => /token|secret|private.?key|password/i.test(key))
    // Do not evaluate secret getters. Without their values we cannot promise masking.
    if (sensitive.some(([, descriptor]) => !("value" in descriptor))) inventoryAvailable = false
    secrets = sensitive.filter(([, descriptor]) => typeof descriptor.value === "string")
      .map(([, descriptor]) => descriptor.value as string).filter(Boolean).sort((a, b) => b.length - a.length)
  } catch { inventoryAvailable = false }
  const clean = (text: string) => {
    for (const secret of secrets) text = text.split(secret).join("<redacted>")
    return text.replace(/([?&](?:token|secret|password|capability)=)[^&#\s]*/gi, "$1<redacted>").slice(0, 2048)
  }
  const safe = (value: unknown, depth = 0, seen = new Set<object>(), budget = { nodes: 64, chars: 4096 }): unknown => {
    if (--budget.nodes < 0) return "<bounded>"
    if (Redacted.isRedacted(value)) return "<redacted>"
    if (typeof value === "string") {
      const text = clean(value).slice(0, Math.max(0, budget.chars))
      budget.chars -= text.length
      return text
    }
    if (value === null || typeof value === "boolean" || typeof value === "number") return value
    if (typeof value !== "object") return `<${typeof value}>`
    if (depth >= 4 || seen.has(value)) return "<bounded>"
    seen.add(value)
    if (Array.isArray(value)) return value.slice(0, 16).map(item => safe(item, depth + 1, seen, budget))
    const output: Record<string, unknown> = {}
    if (value instanceof Error) output.name = clean(value.name)
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value)).slice(0, 16)) {
      output[clean(key).slice(0, 128)] = /token|secret|private.?key|password|authorization|cookie|capability/i.test(key)
        ? "<redacted>" : "value" in descriptor ? safe(descriptor.value, depth + 1, seen, budget) : "<accessor>"
    }
    return output
  }
  return Logger.layer([Logger.make(options => {
    // Serialization/transport failure must not change execution or retry semantics.
    try {
      if (!inventoryAvailable) {
        if (!suppressionReported) {
          suppressionReported = true
          sink.warn({ source: "effect-ci", level: "Warn", message: "Effect diagnostics suppressed: secret inventory unavailable" })
        }
        return
      }
      const annotations = options.fiber.getRef(CurrentLogAnnotations)
      const record = { source: "effect-ci", level: options.logLevel, time: options.date.toISOString(),
        workflow: clean(context.workflow).slice(0, 256), instance: clean(context.instance).slice(0, 256),
        step: clean(String(annotations["ci.step"] ?? "$workflow")).slice(0, 256), attempt: safe(annotations["ci.attempt"] ?? 1),
        message: safe(options.message), cause: safe(options.cause) }
      const method = options.logLevel === "Fatal" || options.logLevel === "Error" ? "error"
        : options.logLevel === "Warn" ? "warn" : options.logLevel === "Debug" || options.logLevel === "Trace" ? "debug" : "info"
      sink[method](record)
    } catch { /* logging is best effort; original error still propagates */ }
  })])
}

/** Preserve failures, including NonRetryableError; logs are not health denominators. */
export const withWobsLogging = <A, E, R>(effect: Effect.Effect<A, E, R>, context: WobsContext, environment: object = {}) =>
  Effect.logInfo("Workflow started").pipe(
    Effect.andThen(effect),
    Effect.tap(() => Effect.logInfo("Workflow completed")),
    Effect.tapCause(cause => Effect.logError("Workflow failed", cause)),
    Effect.provide(wobsLoggerLayer(context, environment)),
  )
