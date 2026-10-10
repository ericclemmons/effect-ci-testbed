import assert from "node:assert/strict"
import test from "node:test"
import { assertHealthyNativeBudget, healthyPhases, healthyBatchSize, maximumHealthyCohorts, maximumHealthyRequests, maximumHealthyQueries } from "./wobs-healthy-budget.ts"
import { MAX_RECEIPTS, COHORT_DEADLINE_MS } from "./wobs-samples.ts"
import { evaluateHealth } from "../../../packages/cloudflare/src/health-gate.ts"

test("native healthy release bounds every phase, SQL retry, request and recovery budget", () => {
  assert.deepEqual(healthyPhases.map(maximumHealthyCohorts), [12, 5, 2, 2])
  assert.equal(maximumHealthyRequests(), 105_140)
  assert.equal(maximumHealthyQueries(), 7_650)
  assert.ok(MAX_RECEIPTS >= 5_000)
  assert.ok(COHORT_DEADLINE_MS + 10_000 < 120_000)
  assert.doesNotThrow(() => assertHealthyNativeBudget())
  assert.throws(() => assertHealthyNativeBudget(10_000), /headroom/)
  assert.throws(() => maximumHealthyCohorts(50), /Invalid healthy phase/)
})

test("healthy observation budgets can resolve the configured gate without a forced healthy result", () => {
  const baseline = { version: "old", from: 1, to: 2, completeThrough: 2, trials: 100, failures: 0, sampling: "unsampled" as const }
  for (const phase of healthyPhases) {
    const policy = { baselineVersion: "old", candidateVersion: "new", baselineWindow: { from: 1, to: 2 }, phaseStartedAt: 3,
      minTrials: 20, maxErrorRate: 0.1, maxIncrease: 0.05, alpha: 0.05, comparisons: healthyPhases.length }
    const sample = { ...baseline, version: "new", from: 3, to: 4, completeThrough: 4, trials: 10 }
    assert.equal(evaluateHealth(baseline, sample, policy).status, "uncertain")
    // Nominal allocation is a feasibility calculation, never a live sample-size
    // guarantee. The controller must still count the actual native version cohort.
    const trials = maximumHealthyCohorts(phase) * healthyBatchSize * phase / 100
    assert.equal(evaluateHealth(baseline, { ...sample, trials }, policy).status, "advance")
    assert.equal(evaluateHealth(baseline, { ...sample, trials, completeThrough: 3 }, policy).status, "uncertain")
    assert.equal(evaluateHealth(baseline, { ...sample, trials, failures: trials }, policy).status, "regression")
  }
})
