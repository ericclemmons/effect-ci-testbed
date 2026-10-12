import assert from "node:assert/strict"
import test from "node:test"
import type { WorkflowStep } from "cloudflare:workers"
import { runHumanReviewedHmd, type HmdObservation } from "./hmd-review-runner.ts"
import type { HmdNativeSource } from "./hmd-native-source.ts"
import type { ReceiptBatch } from "./wobs-samples.ts"

const baseline = "09593237-23b2-4873-bd04-88c8e8488840"
const candidate = "02de9b2e-95d0-49e6-b787-467e25c5a65c"

/** Replay the real failure pattern: ingestion completes a frozen cohort after20s,
 * but adding100 fresh receipts at every30s poll prevents closure forever.
 * The clock/network/broker are fixtures; this is not hosted verification.
 */
test("delayed native ingestion closes the existing cohort before collecting another", async () => {
  const originalNow = Date.now
  let now = 1_000_000
  Date.now = () => now
  const captured = new Map<ReceiptBatch, { at: number; to: number }>()
  const closed = new Set<ReceiptBatch>()
  let capturesBeforeClosure = 0
  const promotions: number[] = []
  const history: HmdObservation[] = []
  let captures = 0
  let restored = 0
  let deadlines = 0
  const journal = { previous: [{ version: baseline, percentage: 100 }], deployment: { id: "restored" } }
  const broker = { begin: async () => journal, renew: async () => journal,
    promote: async (_owner: string, phase: number) => { promotions.push(phase); return journal },
    rollback: async () => { restored++; return journal } } as unknown as Parameters<typeof runHumanReviewedHmd>[2]
  const step = {
    do: async (_key: string, _options: unknown, body: () => Promise<unknown>) => body(),
    sleep: async () => { now += 30_000 },
    waitForEvent: async (_key: string, options: { timeout: number }) => {
      now += options.timeout
      const error = new Error(`Execution timed out after ${options.timeout}ms`)
      error.name = "WorkflowTimeoutError"
      throw error
    },
  } as unknown as WorkflowStep
  const native: HmdNativeSource = {
    capture: async versions => {
      if ([...captured.keys()].some(batch => !closed.has(batch))) capturesBeforeClosure++
      captures++
      const batch = { requested: 100, unknown: 0, receipts: Array.from({ length: 100 }, (_, index) => ({
        ray: (captures * 1000 + index).toString(16).padStart(16, "0"),
        version: versions.length === 1 || index < 90 ? baseline : candidate,
      })) }
      now += 1
      captured.set(batch, { at: now, to: now })
      return batch
    },
    read: async (batches, versions, from, to) => {
      const ready = batches.filter(batch => now >= captured.get(batch)!.at + 20_000)
      const complete = ready.length === batches.length
      if (complete) for (const batch of batches) closed.add(batch)
      return { complete, missing: (batches.length - ready.length) * 100, conflicts: 0, invalid: 0, attributionInvalid: 0,
        nativeRows: ready.length * 100,
        samples: Object.fromEntries(versions.map(version => {
          const trials = ready.flatMap(batch => batch.receipts).filter(receipt => receipt.version === version).length
          return [version, { version, from, to, completeThrough: complete ? to : from,
            trials, failures: version === candidate ? trials : 0, sampling: "unsampled" as const }]
        })),
      }
    },
  }
  try {
    await assert.rejects(runHumanReviewedHmd("ingestion-fixture", step, broker,
      async () => { throw new Error("HTTP fallback prohibited") }, undefined,
      async update => { if (update.type === "observed") history.push(update.observations.at(-1)!) },
      { autoProgressMinutes: 2, allowRegressionOverride: true, samplingIntervalSeconds: 30,
        onRefresh: async () => true,
        onDeadline: async () => { deadlines++; throw new Error("A measured regression cannot be deadline accepted") },
      }, "regression", native), /prior allocation restored/)
    assert.equal(capturesBeforeClosure, 0, "a new request cohort can start only after the previous SQL cohort closed")
    assert.equal(captures, 3, "baseline plus two closed canary cohorts; polls do not add fresh traffic")
    assert.deepEqual(promotions, [10])
    assert.equal(restored, 1)
    assert.equal(deadlines, 0)
    assert.ok(history.some(observation => observation.decision.status === "regression"))
    const breach = history.find(observation => observation.decision.status === "regression")!
    assert.equal(breach.candidate.trials, 10, "a conclusive absolute SLO breach need not wait for the healthy-advancement floor")
    assert.equal(breach.policy.earlyRegression, true)
    const phase = history.filter(observation => observation.phase === 10)
    assert.ok(phase.length >= 2)
    assert.equal(phase[0]!.candidate.to, phase[1]!.candidate.to, "query window remains frozen while ingestion catches up")
  } finally {
    Date.now = originalNow
  }
})
