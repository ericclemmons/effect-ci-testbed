import type { HealthDecision } from "./health-gate.ts"

export interface ReviewMargins {
  readonly maxErrorRate: number
  readonly maxIncrease: number
  /** Absolute percentage-point headroom requiring a human, not a wider SLO. */
  readonly errorGuardBand: number
  readonly increaseGuardBand: number
}

export type HealthRoute =
  | { readonly status: "rollback"; readonly reason: string }
  | { readonly status: "advance"; readonly basis: "health" }
  | { readonly status: "review"; readonly reason: string }

/** Separate opt-in policy. Does not modify the strict automatic health gate. */
export function routeHealthReview(decision: HealthDecision, margins: ReviewMargins): HealthRoute {
  const values = Object.values(margins)
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
    margins.errorGuardBand > margins.maxErrorRate || margins.increaseGuardBand > margins.maxIncrease) {
    throw new Error("Invalid human-review margins")
  }
  if (decision.status === "regression") return { status: "rollback", reason: decision.reason }
  if (decision.status === "uncertain") return { status: "review", reason: decision.reason }
  if (!decision.candidate || !decision.increase ||
    !Number.isFinite(decision.candidate.high) || !Number.isFinite(decision.increase.high) ||
    decision.candidate.high > margins.maxErrorRate || decision.increase.high > margins.maxIncrease) {
    throw new Error("Advance decision does not match the review policy")
  }
  if (decision.candidate.high >= margins.maxErrorRate - margins.errorGuardBand ||
    decision.increase.high >= margins.maxIncrease - margins.increaseGuardBand) {
    return { status: "review", reason: "healthy bounds are within the configured threshold guard band" }
  }
  return { status: "advance", basis: "health" }
}

export interface HealthReviewRequest {
  /** Digest of immutable owner, version, phase, samples and policy. */
  readonly snapshot: string
  readonly expiresAt: number
}

/** Caller must authenticate/authorize the sender before invoking this function.
 * Payload actor names are not authentication. Approval never changes HealthDecision.
 */
export function resolveHealthReview(request: HealthReviewRequest, payload: unknown, now: number) {
  if (!request.snapshot || !Number.isFinite(request.expiresAt) || !Number.isFinite(now) || now >= request.expiresAt) {
    throw new Error("Health review expired")
  }
  if (!payload || typeof payload !== "object") throw new Error("Invalid health review response")
  const value = payload as Record<string, unknown>
  if (value.snapshot !== request.snapshot || !["approved", "rejected"].includes(String(value.decision)) ||
    typeof value.reason !== "string" || !value.reason.trim() || value.reason.length > 500) {
    throw new Error("Invalid or stale health review response")
  }
  return value.decision === "approved"
    ? { status: "advance" as const, basis: "human-risk-acceptance" as const, reason: value.reason }
    : { status: "rollback" as const, reason: value.reason }
}
