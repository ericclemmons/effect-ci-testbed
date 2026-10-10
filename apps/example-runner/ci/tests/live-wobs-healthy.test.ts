import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

const id = process.env.WOBS_HEALTHY_INSTANCE
const incompleteId = process.env.WOBS_HEALTHY_INCOMPLETE_INSTANCE
const diagnosticId = process.env.WOBS_DIAGNOSTIC_INSTANCE
// Read-only: never dispatches, generates traffic, or changes an allocation.
test("native healthy HMD closes each phase cohort before promotion and restores the lab", { skip: !id }, () => {
  const run = JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", ["workflows", "instances", "get", id!,
    "--workflow-name", "effect-ci-probe-wobs-healthy"], { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }))
  assert.equal(run.status, "complete")
  const output = run.output
  assert.equal(output.status, "healthy-all-phases")
  assert.equal(output.evidenceSource, "closed-native-workers-logs-cohort")
  assert.equal(output.wobsVerified, true)
  assert.equal(output.releaseCommitted, false)
  const baseline = "09593237-23b2-4873-bd04-88c8e8488840"
  const candidate = "c94cee12-0bf4-48fb-bb42-9235f7ab7a3c"
  assert.deepEqual(output.promotions.map((p: any) => p.percentage), [10, 25, 75, 100])
  for (const promotion of output.promotions) {
    const versions = promotion.deployment.versions
    assert.equal(versions.find((v: any) => v.version === candidate).percentage, promotion.percentage)
    assert.equal(versions.length, promotion.percentage === 100 ? 1 : 2)
    if (promotion.percentage < 100) assert.equal(versions.find((v: any) => v.version === baseline).percentage, 100 - promotion.percentage)
    assert.equal(versions.reduce((sum: number, v: any) => sum + v.percentage, 0), 100)
    const points = output.observations.filter((p: any) => p.phase === promotion.percentage)
    assert.equal(points[0].decision.status, "uncertain")
    assert.equal(points.at(-1).decision.status, "advance")
    assert.ok(points.at(-1).decision.candidate.high <= 0.1)
    assert.ok(points.at(-1).decision.increase.high <= 0.05)
    assert.ok(points.length >= 2)
  }
  assert.deepEqual(output.restored.versions, [{ version: baseline, percentage: 100 }])
  let previousTime = 0
  for (const point of output.observations) {
    assert.ok(point.observedAt >= previousTime)
    previousTime = point.observedAt
    assert.equal(point.native.failures, 0)
    assert.ok(point.chart.startsWith("<svg ") && point.chart.endsWith("</svg>"))
    assert.equal(point.chart.includes("[truncated"), false)
  }
  const queries = run.steps.filter((s: any) => /:sql-\d+-1$/.test(s.name)).map((s: any) => JSON.parse(s.output))
  const closed = queries.filter((q: any) => q.complete)
  assert.equal(closed.length, output.observations.length + 1)
  for (const cohort of closed) {
    for (const key of ["missing", "conflicts", "invalid"]) assert.equal(cohort[key], 0)
    for (const sample of Object.values(cohort.samples) as any[]) {
      assert.equal(sample.completeThrough, sample.to)
      assert.equal(sample.sampling, "unsampled")
    }
  }
  assert.ok(run.steps.some((s: any) => s.name.includes(":uncertain-")))
  assert.equal(run.steps.find((s: any) => s.name === "release:lab-cleanup-1").success, true)
  assert.ok(run.steps.every((s: any) => !s.name.startsWith("notification:") && !s.name.startsWith("release:restore-after-failure")))
})

test("an incomplete native phase never advances and restores the entire baseline", { skip: !incompleteId }, () => {
  const run = JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", ["workflows", "instances", "get", incompleteId!,
    "--workflow-name", "effect-ci-probe-wobs-healthy"], { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }))
  assert.equal(run.status, "errored")
  assert.match(run.error.message, /Native healthy lab failed; baseline restoration completed/)
  const queries = run.steps.filter((s: any) => /:sql-\d+-1$/.test(s.name))
  const last = JSON.parse(queries.at(-1).output)
  assert.equal(last.complete, false)
  assert.ok(last.missing > 0 || last.invalid > 0 || last.conflicts > 0)
  for (const sample of Object.values(last.samples) as any[]) assert.equal(sample.completeThrough, sample.from)
  const restore = run.steps.find((s: any) => s.name === "release:restore-after-failure-1")
  assert.equal(restore.success, true)
  const restored = JSON.parse(restore.output)
  assert.equal(restored.status, "rolled-back")
  assert.deepEqual(restored.deployment.versions, [{ version: "09593237-23b2-4873-bd04-88c8e8488840", percentage: 100 }])
  assert.equal(run.steps.some((s: any) => s.name === "release:promote-25-1"), false)
  assert.equal(run.steps.some((s: any) => s.name === "release:lab-cleanup-1"), false)
})

test("the failed-window diagnostic proves native sampling without repairing the failed release", { skip: !diagnosticId }, () => {
  const run = JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", ["workflows", "instances", "get", diagnosticId!,
    "--workflow-name", "effect-ci-probe-wobs-diagnostic"], { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 }))
  assert.equal(run.status, "complete")
  const output = run.output
  assert.deepEqual(output.weights, { "1": 4929, "10": 6 })
  assert.equal(output.storedRows, 4935)
  assert.equal(output.valid, 4929)
  assert.equal(output.rejected, 6)
  assert.equal(output.unknownWeight, 0)
  assert.match(output.scope, /diagnostic only/)
  assert.ok(run.steps.every((s: any) => !s.name.startsWith("release:") && !s.name.startsWith("notification:")))
})
