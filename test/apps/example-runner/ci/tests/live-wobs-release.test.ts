import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

const id = process.env.WOBS_RELEASE_INSTANCE
// Read-only recorded evidence: does not dispatch, generate requests, or change allocation.
test("native WOBS regression gates a ten-percent release and restores the full allocation", { skip: !id }, () => {
  const run = JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", ["workflows", "instances", "get", id!,
    "--workflow-name", "effect-ci-probe-wobs-release"], { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }))
  assert.equal(run.status, "complete")
  const output = run.output
  assert.equal(output.status, "rolled-back")
  assert.equal(output.evidenceSource, "closed-native-workers-logs-cohort")
  assert.equal(output.wobsVerified, true)
  assert.equal(output.releaseCommitted, false)
  assert.deepEqual([...output.promotion.versions].sort((a, b) => a.percentage - b.percentage), [
    { version: "02de9b2e-95d0-49e6-b787-467e25c5a65c", percentage: 10 },
    { version: "09593237-23b2-4873-bd04-88c8e8488840", percentage: 90 },
  ])
  assert.deepEqual(output.restored.versions, [{ version: "09593237-23b2-4873-bd04-88c8e8488840", percentage: 100 }])
  assert.equal(output.observations[0].decision.status, "uncertain")
  assert.equal(output.observations.at(-1).decision.status, "regression")
  assert.ok(output.observations.at(-1).decision.candidate.low > 0.1)
  for (const point of output.observations) {
    assert.equal(point.phase, 10)
    assert.ok(point.chart.startsWith("<svg ") && point.chart.endsWith("</svg>"))
    assert.equal(point.chart.includes("[truncated"), false)
  }
  const gate = run.steps.find((s: any) => s.name === "health:conclusive-regression-1")
  assert.equal(gate.config.retries.limit, 10)
  assert.equal(gate.attempts.length, 1)
  assert.match(gate.attempts[0].error.message, /NonRetryableError/)
  assert.equal(run.steps.find((s: any) => s.name === "release:restore-baseline-1").success, true)
  const waits = run.steps.filter((s: any) => s.name.startsWith("health:uncertain-"))
  assert.ok(waits.length >= 1)
  for (const wait of waits) assert.ok(Date.parse(wait.end) - Date.parse(wait.start) >= 60_000)
  assert.ok(run.steps.some((s: any) => s.name.includes(":ingestion-")))
  assert.ok(run.steps.every((s: any) => !s.name.startsWith("notification:")))
  const queries = run.steps.filter((s: any) => /:sql-\d+-1$/.test(s.name)).map((s: any) => JSON.parse(s.output))
  assert.ok(queries.some((q: any) => !q.complete && q.nativeRows === 0))
  const closed = queries.filter((q: any) => q.complete)
  assert.equal(closed.length, output.observations.length + 1)
  for (const cohort of closed) {
    assert.equal(cohort.missing, 0)
    assert.equal(cohort.conflicts, 0)
    assert.equal(cohort.invalid, 0)
    for (const sample of Object.values(cohort.samples) as any[]) {
      assert.equal(sample.completeThrough, sample.to)
      assert.equal(sample.sampling, "unsampled")
    }
  }
})
