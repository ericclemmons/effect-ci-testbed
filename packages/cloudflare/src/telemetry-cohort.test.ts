import assert from "node:assert/strict"
import test from "node:test"
import { reconcileTelemetry } from "./telemetry-cohort.ts"

const manifest = { version: "candidate", from: 100, to: 200, ids: ["one", "two"] }
const row = (id: string, healthy = true) => ({ id, eventId: `event-${id}`, version: "candidate", timestamp: 150, healthy, sampleInterval: 1 })
test("only complete logical cohorts close; duplicate identical delivery is not a second trial", () => {
  const result = reconcileTelemetry(manifest, [row("one"), row("one"), row("two", false)])
  assert.equal(result.sample.trials, 2)
  assert.equal(result.sample.failures, 1)
  assert.equal(result.sample.completeThrough, 200)
  assert.deepEqual(result.missing, [])
})
test("missing rows and conflicting outcomes remain uncertain", () => {
  assert.deepEqual(reconcileTelemetry(manifest, [row("one")]).missing, ["two"])
  const result = reconcileTelemetry(manifest, [row("one"), row("one", false), row("two")])
  assert.equal(result.sample.completeThrough, 100)
  assert.deepEqual(result.conflicts, ["one"])
  assert.equal(result.sample.trials, 1)
  assert.equal(reconcileTelemetry(manifest, [row("one"), { ...row("one"), eventId: "another-execution" }, row("two")]).sample.completeThrough, 100)
})
test("wrong versions, windows, weights and foreign identities never close the cohort", () => {
  for (const invalid of [{ ...row("one"), version: "old" }, { ...row("one"), timestamp: 99 },
    { ...row("one"), timestamp: 200 }, { ...row("one"), sampleInterval: 2 }, row("foreign"),
    { ...row("one"), healthy: undefined }]) {
    const result = reconcileTelemetry(manifest, [invalid, row("two")])
    assert.equal(result.sample.completeThrough, 100)
    assert.ok(result.rejected > 0)
  }
})
test("invalid or empty expected manifests cannot claim completeness", () => {
  for (const ids of [[], ["one", "one"], [""]]) assert.throws(() => reconcileTelemetry({ ...manifest, ids }, []), /Invalid/)
})
test("one native event cannot be counted as two logical trials", () => {
  const result = reconcileTelemetry(manifest, [row("one"), { ...row("two"), eventId: "event-one" }])
  assert.equal(result.sample.trials, 0)
  assert.equal(result.sample.completeThrough, 100)
  assert.deepEqual(result.conflicts.sort(), ["one", "two"])
})
