import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

const id = process.env.WOBS_LARGE_BATCH_INSTANCE
test("recorded five-thousand-receipt native cohort survives real checkpoint serialization and partitioned SQL", { skip: !id }, () => {
  const run = JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", ["workflows", "instances", "get", id!,
    "--workflow-name", "effect-ci-probe-wobs-large-batch"], { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }))
  assert.equal(run.status, "complete")
  assert.equal(run.output.complete, true)
  assert.equal(run.output.requested, 5_000)
  assert.equal(run.output.receipts, 5_000)
  assert.equal(run.output.uniqueReceipts, 5_000)
  assert.equal(run.output.unknown, 0)
  const final = run.output.observations.at(-1)
  assert.equal(final.nativeRows, 5_000)
  for (const key of ["missing", "conflicts", "invalid"]) assert.equal(final[key], 0)
  const sample = final.samples["09593237-23b2-4873-bd04-88c8e8488840"]
  assert.equal(sample.trials, 5_000)
  assert.equal(sample.failures, 0)
  assert.equal(sample.sampling, "unsampled")
  assert.equal(sample.completeThrough, sample.to)
  const barrier = run.steps.find((s: any) => s.name === "wobs:batch-terminal-settle-1")
  assert.ok(Date.parse(barrier.end) - Date.parse(barrier.start) >= 1_000)
  assert.ok(run.steps.every((s: any) => !/^(release|notification):/.test(s.name)))
})
