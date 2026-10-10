import assert from "node:assert/strict"
import test from "node:test"
import { nativeFetchOutcome, sqlFetchOutcome } from "./wobs-cohort.ts"
import { reconcileTelemetry } from "../../../packages/cloudflare/src/telemetry-cohort.ts"

const ids = ["0123456789abcdef", "1123456789abcdef"]
const url = "https://effect-ci-hmd-demo.ericclemmons.workers.dev/health"
const event = (id: string, status = 200) => ({ timestamp: 150, $metadata: { type: "cf-worker-event", requestId: `native-${id}`, rayId: id },
  $workers: { scriptName: "effect-ci-hmd-demo", eventType: "fetch", executionModel: "stateless", truncated: false,
    scriptVersion: { id: "candidate" }, outcome: "ok", event: { request: { method: "GET", url }, response: { status } } } })

test("native terminal identity, not custom log text, binds the exact closed cohort", () => {
  const rows = [nativeFetchOutcome(event(ids[0]!), 1), nativeFetchOutcome(event(ids[1]!, 503), 1)]
  assert.deepEqual(rows.map((row) => row?.healthy), [true, false])
  const result = reconcileTelemetry({ version: "candidate", from: 100, to: 200, ids }, rows)
  assert.equal(result.sample.completeThrough, 200)
  assert.equal(result.sample.trials, 2)
  assert.equal(result.sample.failures, 1)
})
test("missing weights, reset/nonterminal events and mismatched request URLs remain unknown", () => {
  const original = event(ids[0]!)
  for (const weight of [undefined, 0, 2, "1"]) assert.equal(nativeFetchOutcome(original, weight), undefined)
  for (const change of [
    { $metadata: { ...original.$metadata, type: "cf-worker-log" } },
    { $metadata: { ...original.$metadata, requestId: undefined } },
    { $workers: { ...original.$workers, eventType: "alarm" } },
    { $workers: { ...original.$workers, executionModel: "durableObject" } },
    { $workers: { ...original.$workers, truncated: true } },
    { $workers: { ...original.$workers, outcome: "unknown" } },
    { $metadata: { ...original.$metadata, rayId: undefined } },
    { $workers: { ...original.$workers, event: { request: { method: "GET", url: "https://foreign.invalid/health" } } } },
  ]) assert.equal(nativeFetchOutcome({ ...original, ...change }, 1), undefined)
})
test("unrecognized status is not success; native exception is failure even without a response", () => {
  assert.equal(nativeFetchOutcome(event(ids[0]!, 404), 1), undefined)
  const original = event(ids[0]!)
  assert.equal(nativeFetchOutcome({ ...original, $workers: { ...original.$workers, outcome: "exception", event: { request: original.$workers.event.request } } }, 1)?.healthy, false)
})
test("CF-Ray cohort membership is independent of arrived logs", () => {
  const rows = [nativeFetchOutcome(event(ids[0]!), 1), nativeFetchOutcome(event("2123456789abcdef"), 1)]
  const result = reconcileTelemetry({ version: "candidate", from: 100, to: 200, ids }, rows)
  assert.equal(result.sample.completeThrough, 100)
  assert.deepEqual(result.missing, [ids[1]])
  assert.equal(result.rejected, 1)
})

test("SQL projection uses native columns and attributes, not spoofable application outcome", () => {
  const row = { timestamp: 150, scriptName: "effect-ci-hmd-demo", logType: "cf-worker-event", requestId: "native-request", rayId: "0123456789abcdef", sampleInterval: 1,
    attributes: { "$workers.eventType": "fetch", "$workers.executionModel": "stateless", "$workers.truncated": false,
      "$workers.scriptVersion.id": "candidate", "$workers.outcome": "ok", "$workers.event.request.method": "GET",
      "$workers.event.request.url": url, "$workers.event.response.status": 503, "hmd.outcome": "ok" } }
  assert.equal(sqlFetchOutcome(row)?.healthy, false)
  assert.equal(sqlFetchOutcome(row)?.id, row.rayId)
  assert.equal(sqlFetchOutcome({ ...row, attributes: { ...row.attributes, "$workers.event.request.url": "https://effect-ci-hmd-demo.ericclemmons.workers.dev/health?probe=REDACTED" } })?.id, row.rayId)
  assert.equal(sqlFetchOutcome({ ...row, rayId: undefined }), undefined)
  assert.equal(sqlFetchOutcome({ ...row, logType: "cf-worker-log" }), undefined)
  assert.equal(sqlFetchOutcome({ ...row, sampleInterval: "1" }), undefined)
  assert.equal(sqlFetchOutcome({ ...row, attributes: { "hmd.outcome": "ok" } }), undefined)
  assert.equal(sqlFetchOutcome({ ...row, timestamp: "1970-01-01T00:00:00.150Z" })?.timestamp, 150)
})
