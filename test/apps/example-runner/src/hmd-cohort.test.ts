import assert from "node:assert/strict"
import test from "node:test"
import { probeBatch, cohortSample } from "./hmd-cohort.ts"

test("closed HTTP cohorts pin exact version and do not count unknown responses as success", async () => {
  let calls = 0
  const batch = await probeBatch("https://effect-ci-hmd-demo.ericclemmons.workers.dev", "test", ["old", "new"], (async (_url, init) => {
    assert.equal(init?.redirect, "manual")
    calls++
    if (calls === 1) throw new Error("lost response")
    if (calls === 2) return Response.json({ version: "unexpected", healthy: true })
    return Response.json({ version: "new", healthy: false }, { status: 503 })
  }) as typeof fetch)
  assert.equal(calls, 100)
  assert.equal(batch.unknown, 2)
  assert.deepEqual(batch.unknownReasons, { transport: 1, attribution: 1 })
  const sample = cohortSample([batch], "new", 1, 2)
  assert.equal(sample.trials, 98)
  assert.equal(sample.failures, 98)
  assert.equal(sample.completeThrough, 1)
})

test("complete version-specific batches close only the client-observed window", async () => {
  const batch = await probeBatch("https://effect-ci-hmd-demo.ericclemmons.workers.dev", "test", ["old"], (async () => Response.json({ version: "old", healthy: true })) as typeof fetch)
  assert.deepEqual(cohortSample([batch], "old", 1, 2), {
    version: "old", from: 1, to: 2, completeThrough: 2, trials: 100, failures: 0, sampling: "unsampled",
  })
  await assert.rejects(probeBatch("https://arbitrary.invalid", "test", ["old"]), /Invalid probe target/)
})
