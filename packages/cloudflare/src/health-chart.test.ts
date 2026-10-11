import { test } from "node:test"
import assert from "node:assert/strict"
import { healthChart } from "./health-chart.ts"

test("health chart renders version cohorts and escapes all user labels", () => {
  const svg = healthChart([{ elapsedSeconds: 60, decision: { status: "advance", reason: "ok",
    baseline: { low: 0, rate: 0.01, high: 0.03 }, candidate: { low: 0, rate: 0.01, high: 0.04 } } }],
  { baseline: '<script>alert("x")</script>', candidate: "new", maxErrorRate: 0.05 })
  assert.ok(svg.includes("&lt;script&gt;"))
  assert.ok(!svg.includes("<script>"))
  assert.ok(svg.includes("Decision: advance"))
  assert.equal((svg.match(/<circle/g) ?? []).length, 2, "single observations have visible points and whiskers, not degenerate bands")
})

test("missing candidate traffic does not erase the previous version or invent a zero rate", () => {
  const sample = { version: "old", from: 1000, to: 2000, completeThrough: 2000, trials: 100, failures: 2, sampling: "unsampled" as const }
  const svg = healthChart([{ elapsedSeconds: 1, baselineSample: sample,
    candidateSample: { ...sample, version: "new", from: 2000, to: 3000, trials: 0, failures: 0 },
    decision: { status: "uncertain", reason: "no candidate traffic", baseline: { rate: .02, low: 0, high: .3 } } }],
    { baseline: "old", candidate: "new", maxErrorRate: .1 })
  assert.match(svg, /2 errors \/ 100 requests/)
  assert.match(svg, /2.00% observed errors/)
  assert.match(svg, /No observations yet/)
  assert.match(svg, /00:00:01.000–00:00:02.000 UTC/)
  assert.equal((svg.match(/<circle/g) ?? []).length, 1)
})

test("no data is visibly uncertain, not a zero-error success chart", () => {
  const svg = healthChart([{ elapsedSeconds: 0, decision: { status: "uncertain", reason: "missing" } }], { baseline: "old", candidate: "new", maxErrorRate: 0.1 })
  assert.ok(svg.includes("no confidence estimate yet"))
  assert.throws(() => healthChart([{ elapsedSeconds: NaN, decision: { status: "uncertain", reason: "missing" } }], { baseline: "old", candidate: "new", maxErrorRate: 0.1 }))
})
