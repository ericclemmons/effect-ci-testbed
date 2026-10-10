import assert from "node:assert/strict"
import test from "node:test"
import { collectReceipts, readReceiptSamples, combineSamples } from "./wobs-samples.ts"

const old = "0123456789abcdef", candidate = "1123456789abcdef"
const batch = { requested: 2, unknown: 0, receipts: [{ ray: old, version: "old" }, { ray: candidate, version: "new" }] }
const row = (ray: string, version: string, status = 200) => ({ timestamp: 150, scriptName: "effect-ci-hmd-demo", logType: "cf-worker-event",
  requestId: `native-${ray}`, rayId: ray, sampleInterval: 1, attributes: { "$workers.eventType": "fetch", "$workers.executionModel": "stateless",
    "$workers.truncated": false, "$workers.scriptVersion.id": version, "$workers.outcome": "ok", "$workers.event.request.method": "GET",
    "$workers.event.request.url": "https://effect-ci-hmd-demo.ericclemmons.workers.dev/health", "$workers.event.response.status": status } })
const rows = [row(old, "old"), row(candidate, "new", 503)]

test("mixed native version cohorts require independent receipts and every terminal event", async () => {
  const result = await readReceiptSamples(batch, ["old", "new"], 100, 200, async (input) => {
    assert.ok(input.query.includes("rayId IN ($ray0,$ray1)"))
    assert.equal(input.params.ray0, old)
    return { data: [...rows, { ...rows[0]!, logType: "cf-worker" }] }
  })
  assert.equal(result.complete, true)
  assert.equal(result.samples.old?.failures, 0)
  assert.equal(result.samples.new?.failures, 1)
  assert.equal(result.samples.new?.trials, 1)
})
test("missing, sampled, duplicate execution identities across versions and mismatches taint every cohort", async () => {
  for (const data of [[rows[0]!], [rows[0]!, { ...rows[1]!, sampleInterval: 2 }],
    [rows[0]!, { ...rows[1]!, requestId: rows[0]!.requestId }], [rows[0]!, row(candidate, "old")]]) {
    const result = await readReceiptSamples(batch, ["old", "new"], 100, 200, async () => ({ data }))
    assert.equal(result.complete, false)
    assert.ok(Object.values(result.samples).every((s) => s.completeThrough === 100))
  }
})
test("absence of an executed version is zero observations, not a healthy release", async () => {
  const result = await readReceiptSamples({ requested: 1, unknown: 0, receipts: [batch.receipts[0]!] }, ["old", "new"], 100, 200, async () => ({ data: [rows[0]!] }))
  assert.equal(result.complete, true)
  assert.equal(result.samples.new?.trials, 0)
  const none = await readReceiptSamples({ requested: 2, unknown: 2, receipts: [] }, ["old", "new"], 100, 200, async () => { throw new Error("must not query empty identity list") })
  assert.equal(none.complete, false)
})
test("transport loses receipts without retrying or reconstructing identities from query results", async () => {
  let calls = 0
  const result = await collectReceipts(2, ["new"], (async () => {
    calls++
    return Response.json({ version: "new", healthy: false }, { status: 503, headers: calls === 1 ? { "cf-ray": `${candidate}-IAD` } : {} })
  }) as typeof fetch)
  assert.equal(calls, 2)
  assert.equal(result.receipts.length, 1)
  assert.equal(result.unknown, 1)
})
test("cumulative samples never repair a missing earlier window", () => {
  const sample = { version: "new", from: 100, to: 200, completeThrough: 200, trials: 10, failures: 10, sampling: "unsampled" as const }
  const result = combineSamples([sample, { ...sample, from: 200, to: 300, completeThrough: 200 }], "new", 100, 300)
  assert.equal(result.completeThrough, 100)
  assert.equal(result.trials, 20)
})

test("corrupt independent manifests reject before querying and duplicate delivery is not another trial", async () => {
  let queries = 0
  const query = async () => { queries++; return { data: [...rows, rows[1]!] } }
  for (const corrupt of [
    { ...batch, requested: 3 }, { ...batch, unknown: -1 },
    { ...batch, receipts: [batch.receipts[0]!, batch.receipts[0]!] },
    { ...batch, receipts: [batch.receipts[0]!, { ray: candidate, version: "foreign" }] },
  ]) await assert.rejects(readReceiptSamples(corrupt, ["old", "new"], 100, 200, query), /Invalid closed receipt cohort/)
  assert.equal(queries, 0)
  const duplicate = await readReceiptSamples(batch, ["old", "new"], 100, 200, query)
  assert.equal(duplicate.complete, true)
  assert.equal(duplicate.samples.new?.trials, 1)
  assert.equal(duplicate.samples.new?.failures, 1)
  const outside = await readReceiptSamples(batch, ["old", "new"], 100, 200, async () => ({ data: [rows[0]!, { ...rows[1]!, timestamp: 200 }] }))
  assert.equal(outside.complete, false)
  assert.deepEqual(outside.nativeTimeRange, { from: 150, to: 200 })
  assert.equal(outside.samples.new?.completeThrough, 100)
})

test("large cohorts partition SQL without weakening cross-partition native identity checks", async () => {
  const receipts = Array.from({ length: 1_000 }, (_, index) => ({ ray: index.toString(16).padStart(16, "0"), version: "old" }))
  let calls = 0
  const query = async (input: { params: Record<string, string> }) => {
    calls++
    const rays = Object.entries(input.params).filter(([key]) => key.startsWith("ray")).map(([, ray]) => ray)
    assert.equal(rays.length, 100)
    return { data: rays.map((ray) => row(ray, "old")) }
  }
  const large = { requested: 1_000, unknown: 0, receipts }
  const complete = await readReceiptSamples(large, ["old"], 100, 200, query)
  assert.equal(calls, 10)
  assert.equal(complete.complete, true)
  assert.equal(complete.samples.old?.trials, 1_000)
  assert.ok(Buffer.byteLength(JSON.stringify(large)) < 512 * 1024)
  const collision = await readReceiptSamples(large, ["old"], 100, 200, async (input) => {
    const result = await query(input)
    return { data: result.data.map((entry) => entry.rayId === receipts[100]!.ray ? { ...entry, requestId: `native-${receipts[0]!.ray}` } : entry) }
  })
  assert.equal(collision.complete, false)
  assert.equal(collision.samples.old?.completeThrough, 100)
  await assert.rejects(readReceiptSamples({ ...large, requested: 1_001 }, ["old"], 100, 200, query), /Invalid closed receipt cohort/)
})

test("lost receipts stop larger traffic batches without replacing or silently dropping unknown work", async () => {
  let calls = 0
  const result = await collectReceipts(1_000, ["old"], (async () => {
    calls++
    return Response.json({ version: "old", healthy: true }, { headers: {} })
  }) as typeof fetch)
  assert.equal(calls, 5)
  assert.equal(result.requested, 1_000)
  assert.equal(result.unknown, 1_000)
  assert.equal(result.receipts.length, 0)
})
