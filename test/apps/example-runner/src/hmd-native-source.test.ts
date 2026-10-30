import assert from "node:assert/strict"
import test from "node:test"
import type { WorkflowStep } from "cloudflare:workers"
import { nativeHmdSource, type HmdNativeSource } from "./hmd-native-source.ts"
import { runHumanReviewedHmd, type HmdObservation } from "./hmd-review-runner.ts"
import { hmdCardObserver } from "../../../../apps/effect-ci/src/hmd-card.ts"
import { RunCard } from "../../../../packages/github-cloudflare/src/run-card.ts"

const baseline = "09593237-23b2-4873-bd04-88c8e8488840"
const candidate = "c94cee12-0bf4-48fb-bb42-9235f7ab7a3c"
const ray = "0123456789abcdef"
const batch = { requested: 1, unknown: 0, receipts: [{ ray, version: candidate }] }
const row = { timestamp: 150, scriptName: "effect-ci-hmd-demo", logType: "cf-worker-event",
  rayId: ray, requestId: "native-event", sampleInterval: 1, attributes: {
    "$workers.eventType": "fetch", "$workers.executionModel": "stateless", "$workers.truncated": false,
    "$workers.scriptVersion.id": candidate, "$workers.outcome": "ok", "$workers.event.request.method": "GET",
    "$workers.event.request.url": "https://effect-ci-hmd-demo.eclemmons.workers.dev/health",
    "$workers.event.response.status": 503,
  } }

test("native ingestion re-reads frozen receipts, never replaces them or uses HTTP health", async () => {
  let queries = 0
  const source = nativeHmdSource(async (input) => {
    queries++
    assert.equal(input.params.ray0, ray)
    return { data: queries === 1 ? [] : [row, row] }
  }, async () => { throw new Error("No replacement traffic") })
  const pending = await source.read([batch], [candidate], 100, 200)
  assert.equal(pending.complete, false)
  assert.equal(pending.missing, 1)
  const closed = await source.read([batch], [candidate], 100, 200)
  assert.equal(closed.complete, true)
  assert.equal(closed.samples[candidate]!.failures, 1)
  assert.equal(closed.samples[candidate]!.trials, 1, "duplicate native delivery is one trial")
})

test("sampled native rows cannot produce complete independent trials", async () => {
  const source = nativeHmdSource(async () => ({ data: [{ ...row, sampleInterval: 10 }] }))
  const result = await source.read([batch], [candidate], 100, 200)
  assert.equal(result.complete, false)
  assert.equal(result.samples[candidate]!.completeThrough, 100)
  assert.equal(result.samples[candidate]!.trials, 0)
  assert.equal(result.attributionInvalid, 0, "sampling is uncertainty, not valid independent trials or foreign provenance")
})

test("foreign version attribution is not an approvable statistical shortage", async () => {
  const source = nativeHmdSource(async () => ({ data: [{ ...row,
    attributes: { ...row.attributes, "$workers.scriptVersion.id": "foreign" } }] }))
  const result = await source.read([batch], [candidate], 100, 200)
  assert.equal(result.complete, false)
  assert.equal(result.attributionInvalid, 1)
})

for (const mode of ["healthy", "uncertain", "baseline-missing", "query-error", "regression"] as const) {
test(`native controller and existing card: ${mode}`, async () => {
  let captures = 0
  let baselineReads = 0
  let restores = 0
  let waits = 0
  let inside = false
  const promotions: number[] = []
  let current: HmdObservation | undefined
  const frames: string[] = []
  const keys: string[] = []
  const journal = { previous: [{ version: baseline, percentage: 100 }], deployment: { id: "restored" } }
  const broker = { begin: async () => journal, renew: async () => journal,
    promote: async (_owner: string, phase: number) => { promotions.push(phase); return journal },
    rollback: async () => { restores++; return journal } } as unknown as Parameters<typeof runHumanReviewedHmd>[2]
  const native: HmdNativeSource = {
    capture: async (versions) => {
      captures++
      return { requested: 100, unknown: 0, receipts: Array.from({ length: 100 }, (_, index) => ({
        ray: (captures * 1000 + index).toString(16).padStart(16, "0"), version: versions.at(-1)!,
      })) }
    },
    read: async (batches, versions, from, to) => {
      if (mode === "query-error") throw { retryable: false }
      const previous = versions.length === 1
      if (previous) baselineReads++
      const complete = mode !== "baseline-missing" && (previous || mode !== "uncertain")
      // Pure policy/bridge fixture, not an attainable native batch or live proof.
      // Large independent counts exercise clear bounds outside the guard band.
      const count = mode === "healthy" ? 10000 : 100
      assert.equal(batches.length, 1)
      return { complete, samples: Object.fromEntries(versions.map((version) => [version, {
        version, from, to, completeThrough: complete ? to : from, trials: count,
        failures: !previous && mode === "regression" ? count : 0, sampling: "unsampled" as const,
      }])), missing: complete ? 0 : 1, conflicts: 0, invalid: 0, attributionInvalid: 0, nativeRows: complete ? count : count - 1 }
    },
  }
  const step = {
    do: async (key: string, _options: unknown, body: () => Promise<unknown>) => {
      assert.equal(inside, false, "native checkpoints cannot nest")
      keys.push(key); inside = true
      try { return await body() } finally { inside = false }
    },
    sleep: async () => {},
    waitForEvent: async () => {
      waits++
      assert.equal(current!.decision.status, "uncertain")
      return { payload: { snapshot: current!.snapshot, decision: "approved", reason: "Automated fixture risk acceptance, not a human" } }
    },
  } as unknown as WorkflowStep
  const card = new RunCard({ instanceId: "native-test", repository: "owner/repo", revision: "abcdef123" })
  const bridge = hmdCardObserver("native-test", step, card, {
    includeImage: true,
    render: async (points) => { assert.equal(inside, true); assert.ok(points.at(-1)!.baselineSample); return new Uint8Array([1]) },
    upload: async () => ({ ok: true, fileId: "F1" }),
    publish: async (owned) => { assert.equal(owned, card); frames.push(JSON.stringify(card.render())) },
  })
  const run = runHumanReviewedHmd("native-test", step, broker, async () => { throw new Error("HTTP fallback forbidden") },
    undefined, async update => {
      if (update.type === "observed") current = update.observations.at(-1)
      await bridge(update)
    }, undefined, "healthy", native)
  if (["healthy", "uncertain"].includes(mode)) {
    const result = await run
    assert.deepEqual(promotions, mode === "healthy" ? [10, 25, 75, 100] : [10, 10, 25, 25, 75, 75, 100, 100])
    assert.ok(result.observations.every(o => o.basis === (mode === "healthy" ? "health" : "human-risk-acceptance")))
    assert.equal(waits, mode === "healthy" ? 0 : 4)
    assert.equal(result.releaseCommitted, false)
    assert.equal(result.wobsVerified, false, "unit tests cannot certify hosted WOBS")
  } else {
    await assert.rejects(run, /prior allocation restored/)
    assert.deepEqual(promotions, mode === "regression" ? [10] : [])
    assert.equal(waits, 0)
    if (mode === "baseline-missing") { assert.equal(baselineReads, 4); assert.equal(captures, 1) }
    if (mode === "query-error") assert.equal(keys.filter(k => k.startsWith("health:native-baseline")).length, 1)
  }
  assert.equal(restores, 1)
  assert.ok(frames.every(frame => frame.includes("experimental-native-wobs")))
  assert.ok(frames.every(frame => !frame.includes("HTTP cohort")))
  if (current?.telemetry?.complete === false) assert.equal(current.decision.status, "uncertain")
})
}
