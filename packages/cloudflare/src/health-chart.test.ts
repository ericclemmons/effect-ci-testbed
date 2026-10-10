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
  assert.equal((svg.match(/<polygon/g) ?? []).length, 2)
})

test("no data is visibly uncertain, not a zero-error success chart", () => {
  const svg = healthChart([{ elapsedSeconds: 0, decision: { status: "uncertain", reason: "missing" } }], { baseline: "old", candidate: "new", maxErrorRate: 0.1 })
  assert.ok(svg.includes("no confidence estimate yet"))
  assert.throws(() => healthChart([{ elapsedSeconds: NaN, decision: { status: "uncertain", reason: "missing" } }], { baseline: "old", candidate: "new", maxErrorRate: 0.1 }))
})
