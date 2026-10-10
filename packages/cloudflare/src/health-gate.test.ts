import { test } from "node:test"
import assert from "node:assert/strict"
import { evaluateHealth, rateInterval, type HealthSample, type HealthPolicy } from "./health-gate.ts"

const policy: HealthPolicy = { baselineVersion: "old", candidateVersion: "new", phaseStartedAt: 100,
  baselineWindow: { from: 0, to: 100 },
  minTrials: 100, maxErrorRate: 0.1, maxIncrease: 0.05, alpha: 0.05, comparisons: 4 }
const sample = (candidate: boolean, trials = 100000, failures = 0): HealthSample => ({
  version: candidate ? "new" : "old", from: candidate ? 100 : 0, to: candidate ? 200 : 100,
  completeThrough: 200, trials, failures, sampling: "unsampled" })

test("health gate distinguishes uncertainty, advance and conclusive regression", () => {
  assert.equal(evaluateHealth(sample(false, 0), sample(true, 0), policy).status, "uncertain")
  assert.ok(evaluateHealth(sample(false), sample(true, 1), policy).candidate)
  assert.equal(evaluateHealth(sample(false), sample(true, 100), policy).status, "uncertain")
  assert.equal(evaluateHealth(sample(false), sample(true), policy).status, "advance")
  assert.equal(evaluateHealth(sample(false), sample(true, 100000, 20000), policy).status, "regression")
})

test("no candidate traffic, sampled counts, wrong versions and late data never mean healthy", () => {
  for (const candidate of [sample(true, 0), { ...sample(true), sampling: "weighted" as const },
    { ...sample(true), version: "old" }, { ...sample(true), from: 99 }, { ...sample(true), completeThrough: 199 }]) {
    assert.equal(evaluateHealth(sample(false), candidate, policy).status, "uncertain")
  }
  assert.equal(evaluateHealth({ ...sample(false), from: -100 }, sample(true), policy).status, "uncertain")
  assert.equal(evaluateHealth(sample(false), { ...sample(true), from: 101 }, policy).status, "uncertain")
})

test("bounds narrow as independent data arrives, and account for more simultaneous gates", () => {
  const early = rateInterval(sample(true, 100), policy)
  const late = rateInterval(sample(true), policy)
  assert.ok(late.high - late.low < early.high - early.low)
  assert.ok(rateInterval(sample(true), { ...policy, comparisons: 8 }).high > late.high)
  assert.equal(evaluateHealth(sample(false), sample(true), { ...policy, maxIncrease: 0 }).status, "uncertain")
})

test("invalid probabilities, fractional weighted totals and corrupt failures fail closed", () => {
  assert.throws(() => evaluateHealth(sample(false), sample(true), { ...policy, alpha: 0 }))
  assert.throws(() => evaluateHealth(sample(false), { ...sample(true), trials: 1.5 }, policy))
  assert.throws(() => evaluateHealth(sample(false), { ...sample(true), failures: 100001 }, policy))
})
