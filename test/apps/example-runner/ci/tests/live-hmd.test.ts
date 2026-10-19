import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

// Read-only validation of recorded executions. Never dispatches or redeploys.
const read = (id: string) => JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", [
  "workflows", "instances", "get", id, "--workflow-name", "effect-ci-probe-hosted-hmd",
], { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }))

for (const scenario of ["regression", "exhaustion", "healthy"] as const) {
  const id = process.env[{ regression: "HMD_REGRESSION_INSTANCE", exhaustion: "HMD_EXHAUSTION_INSTANCE", healthy: "HMD_HEALTHY_INSTANCE" }[scenario]]
  test(`recorded hosted HMD ${scenario}: native decisions, immutable charts and exact rollback`, { skip: !id }, () => {
    const run = read(id!)
    assert.equal(run.status, "complete")
    assert.equal(run.output.scenario, scenario)
    assert.equal(run.output.status, scenario === "healthy" ? "healthy-all-phases" : "rolled-back")
    assert.equal(run.output.evidenceSource, "closed-client-http-cohort")
    assert.equal(run.output.wobsVerified, false)
    assert.deepEqual(run.output.restored.versions, [{ version: "09593237-23b2-4873-bd04-88c8e8488840", percentage: 100 }])
    for (const point of run.output.observations) {
      assert.ok(point.chart.startsWith("<svg "))
      assert.ok(point.chart.endsWith("</svg>"))
      assert.equal(point.chart.includes("[truncated"), false)
    }
    const waits = run.steps.filter((step: any) => step.name.startsWith("health:uncertain-"))
    assert.ok(waits.length)
    for (const wait of waits) assert.ok(Date.parse(wait.end) - Date.parse(wait.start) >= 60_000)
    const rollback = run.steps.find((step: any) => step.name === (scenario === "healthy" ? "release:lab-cleanup-1" : "release:restore-baseline-1"))
    assert.equal(rollback.success, true)
    if (scenario === "regression") {
      assert.equal(run.output.observations[0].decision.status, "uncertain")
      assert.equal(run.output.observations.at(-1).decision.status, "regression")
      const gate = run.steps.find((step: any) => step.name === "health:conclusive-regression-1")
      assert.equal(gate.config.retries.limit, 10)
      assert.equal(gate.attempts.length, 1)
      assert.match(gate.attempts[0].error.message, /NonRetryableError/)
    } else if (scenario === "exhaustion") {
      assert.equal(run.output.observations.length, 10)
      assert.equal(waits.length, 9)
      assert.ok(run.output.observations.every((point: any) => point.decision.status === "uncertain"))
      assert.match(run.output.reason, /budget exhausted/)
    } else {
      assert.equal(run.output.releaseCommitted, false)
      assert.deepEqual(run.output.promotions.map((item: any) => item.percentage), [10, 25, 75, 100])
      for (const promotion of run.output.promotions) {
        assert.equal(promotion.deployment.versions.find((item: any) => item.version === "c94cee12-0bf4-48fb-bb42-9235f7ab7a3c")?.percentage, promotion.percentage)
        assert.equal(promotion.deployment.versions.reduce((sum: number, item: any) => sum + item.percentage, 0), 100)
        const samples = run.output.observations.filter((item: any) => item.phase === promotion.percentage)
        assert.equal(samples.at(-1)?.decision.status, "advance")
      }
    }
  })
}
