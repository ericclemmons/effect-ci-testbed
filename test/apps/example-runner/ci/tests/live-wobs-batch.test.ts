import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

const id = process.env.WOBS_BATCH_INSTANCE
test("recorded thousand-receipt native WOBS batch closes without mutation or notification", { skip: !id }, () => {
  const run = JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", ["workflows", "instances", "get", id!,
    "--workflow-name", "effect-ci-probe-wobs-batch"], { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }))
  assert.equal(run.status, "complete")
  assert.equal(run.output.complete, true)
  assert.equal(run.output.requested, 1_000)
  assert.equal(run.output.receipts, 1_000)
  assert.equal(run.output.uniqueReceipts, 1_000)
  assert.equal(run.output.unknown, 0)
  const final = run.output.observations.at(-1)
  assert.equal(final.nativeRows, 1_000)
  for (const key of ["missing", "conflicts", "invalid"]) assert.equal(final[key], 0)
  const sample = final.samples["09593237-23b2-4873-bd04-88c8e8488840"]
  assert.equal(sample.trials, 1_000)
  assert.equal(sample.failures, 0)
  assert.equal(sample.sampling, "unsampled")
  assert.equal(sample.completeThrough, sample.to)
  const barrier = run.steps.find((s: any) => s.name === "wobs:batch-terminal-settle-1")
  assert.ok(Date.parse(barrier.end) - Date.parse(barrier.start) >= 1_000)
  assert.ok(run.steps.every((s: any) => !/^(release|notification):/.test(s.name)))
})

const incomplete = process.env.WOBS_BATCH_INCOMPLETE_INSTANCE
test("recorded incomplete batch never converts native-data gaps into healthy evidence", { skip: !incomplete }, () => {
  const run = JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", ["workflows", "instances", "get", incomplete!,
    "--workflow-name", "effect-ci-probe-wobs-batch"], { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }))
  assert.equal(run.status, "complete")
  assert.equal(run.output.complete, false)
  assert.equal(run.output.receipts, 1_000)
  assert.equal(run.output.uniqueReceipts, 1_000)
  assert.equal(run.output.unknown, 0)
  assert.equal(run.output.observations.length, 6)
  const final = run.output.observations.at(-1)
  assert.ok(final.missing > 0)
  const sample = final.samples["09593237-23b2-4873-bd04-88c8e8488840"]
  assert.ok(sample.trials < 1_000)
  assert.equal(sample.completeThrough, sample.from)
  assert.ok(run.steps.every((s: any) => !/^(release|notification):/.test(s.name)))
  if (run.output.clockDiagnostic) {
    assert.match(run.output.clockDiagnostic.scope, /original sample is unchanged/)
    assert.equal(run.output.clockDiagnostic.completeInWiderEnvelope, true)
    assert.equal(run.output.clockDiagnostic.nativeRows, 1_000)
    assert.ok(run.output.clockDiagnostic.latestMinusEnd > 0)
  }
})
