import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

const id = process.env.WOBS_COHORT_INSTANCE
// Read-only verification of recorded native evidence; never creates traffic or deploys.
test("recorded native SQL cohort accounts for all twenty independent CF-Ray receipts", { skip: !id }, () => {
  const run = JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", ["workflows", "instances", "get", id!,
    "--workflow-name", "effect-ci-probe-wobs-cohort"], { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }))
  assert.equal(run.status, "complete")
  assert.equal(run.output.complete, true)
  assert.equal(run.output.traffic.acknowledged, 20)
  assert.equal(run.output.traffic.unknown, 0)
  assert.equal(new Set(run.output.traffic.rays).size, 20)
  const final = run.output.observations.at(-1)
  assert.equal(final.nativeRows, 20)
  assert.equal(final.rejected, 0)
  assert.equal(final.missing.length, 0)
  assert.equal(final.conflicts.length, 0)
  assert.equal(final.sample.trials, 20)
  assert.equal(final.sample.failures, 0)
  assert.equal(final.sample.version, "09593237-23b2-4873-bd04-88c8e8488840")
  assert.equal(final.sample.sampling, "unsampled")
  assert.equal(final.sample.completeThrough, final.sample.to)
  assert.ok(run.steps.every((step: { name?: string }) => !step.name?.startsWith("release:")))
})
