import * as Schema from "effect/Schema"
import * as Option from "effect/Option"

const FailureName = Schema.Literals(["Error", "TypeError", "RangeError", "AbortError", "TimeoutError", "RpcError"])
const FailureCode = Schema.Literals(["ECONNRESET", "EPIPE", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED"])
const HttpStatus = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 100, maximum: 599 }))
export const ContainerBoundary = Schema.Struct({
  scope: Schema.Literals(["workspace", "readiness", "command", "auxiliary"]),
  phase: Schema.Literals(["materialize", "restore", "start", "configuration", "exec", "exit", "output", "decode"]),
  state: Schema.Literals(["started", "received", "completed", "failed"]),
  running: Schema.Boolean,
  hasSnapshot: Schema.optionalKey(Schema.Boolean),
  checkpointMatches: Schema.optionalKey(Schema.Boolean),
  activeStepMatches: Schema.optionalKey(Schema.Boolean),
  dirty: Schema.optionalKey(Schema.Boolean),
  hasMutation: Schema.optionalKey(Schema.Boolean),
  exitCode: Schema.optionalKey(Schema.Number.check(Schema.isInt())),
  errorName: Schema.optionalKey(FailureName),
  errorCode: Schema.optionalKey(FailureCode),
  httpStatus: Schema.optionalKey(HttpStatus),
})
export type ContainerBoundary = typeof ContainerBoundary.Type
export type ContainerObserver = (event: ContainerBoundary) => void

/** Never messages, stacks, handles, commands, environment or arbitrary fields.
 * Unknown provider classifications stay unknown, not string-parsed guesses. */
export function containerFailure(error: unknown): Pick<ContainerBoundary, "errorName" | "errorCode" | "httpStatus"> {
  if (typeof error !== "object" || error === null) return {}
  try {
    const value = error as { name?: unknown; code?: unknown; status?: unknown }
    const errorName = Option.getOrUndefined(Schema.decodeUnknownOption(FailureName)(value.name))
    const errorCode = Option.getOrUndefined(Schema.decodeUnknownOption(FailureCode)(value.code))
    const httpStatus = Option.getOrUndefined(Schema.decodeUnknownOption(HttpStatus)(value.status))
    return { ...(errorName ? { errorName } : {}), ...(errorCode ? { errorCode } : {}), ...(httpStatus ? { httpStatus } : {}) }
  } catch { return {} }
}
