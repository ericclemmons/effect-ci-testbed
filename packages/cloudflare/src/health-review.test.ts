import assert from "node:assert/strict"
import { test } from "node:test"
import { routeHealthReview, resolveHealthReview } from "./health-review.ts"
import type { HealthDecision } from "./health-gate.ts"

const margins = { maxErrorRate: 0.1, maxIncrease: 0.05, errorGuardBand: 0.02, increaseGuardBand: 0.01 }
const healthy: HealthDecision = { status: "advance", reason: "within budget",
  candidate: { rate: 0, low: 0, high: 0.03 }, increase: { low: -0.03, high: 0.03 } }

test("strict regression can never enter the human-approval route", () => {
  assert.deepEqual(routeHealthReview({ status: "regression", reason: "SLO breach" }, margins),
    { status: "rollback", reason: "SLO breach" })
})
test("inconclusive data requires explicit risk acceptance, never a healthy label", () => {
  const decision: HealthDecision = { status: "uncertain", reason: "telemetry still arriving" }
  assert.equal(routeHealthReview(decision, margins).status, "review")
  assert.equal(resolveHealthReview({ snapshot: "owner-version-phase-data", expiresAt: 100 },
    { snapshot: "owner-version-phase-data", decision: "approved", reason: "Accept bounded canary risk" }, 99).status, "advance")
  assert.equal(decision.status, "uncertain")
})
test("clear health advances automatically; either near-margin bound requires review", () => {
  assert.deepEqual(routeHealthReview(healthy, margins), { status: "advance", basis: "health" })
  for (const decision of [
    { ...healthy, candidate: { rate: 0, low: 0, high: 0.085 } },
    { ...healthy, increase: { low: -0.03, high: 0.045 } },
  ]) assert.equal(routeHealthReview(decision, margins).status, "review")
})
test("review rejects wrong phase/snapshot, malformed response, no rationale and expiry", () => {
  const request = { snapshot: "phase-10-digest", expiresAt: 100 }
  const payload = { snapshot: request.snapshot, decision: "approved", reason: "Reviewed" }
  for (const value of [undefined, {}, { ...payload, snapshot: "phase-25-digest" },
    { ...payload, decision: "maybe" }, { ...payload, reason: " " }]) {
    assert.throws(() => resolveHealthReview(request, value, 90))
  }
  assert.throws(() => resolveHealthReview(request, payload, 100))
  assert.throws(() => resolveHealthReview(request, payload, NaN))
  assert.equal(resolveHealthReview(request, { ...payload, decision: "rejected" }, 90).status, "rollback")
})
test("guard bands cannot widen thresholds or accept contradictory advance decisions", () => {
  assert.throws(() => routeHealthReview(healthy, { ...margins, errorGuardBand: 0.2 }))
  assert.throws(() => routeHealthReview({ ...healthy, candidate: { rate: 0.2, low: 0.1, high: 0.3 } }, margins))
})
