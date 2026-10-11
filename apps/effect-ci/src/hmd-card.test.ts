import assert from "node:assert/strict"
import test from "node:test"
import type { WorkflowStep } from "cloudflare:workers"
import type { HmdObservation } from "../../example-runner/src/hmd-review-runner.ts"
import { RunCard } from "../../../packages/github-cloudflare/src/run-card.ts"
import { hmdCardObserver } from "./hmd-card.ts"
import { runHumanReviewedHmd } from "../../example-runner/src/hmd-review-runner.ts"

function observation(phase: 10 | 25 | 75 | 100): HmdObservation {
  return { owner: "run", phase, snapshot: String(phase).padStart(64, "0"), expiresAt: 5000,
    baseline: { version: "old", from: 0, to: 100, completeThrough: 100, trials: 100, failures: 0, sampling: "unsampled" },
    candidate: { version: "new", from: phase * 100, to: phase * 100 + 1, completeThrough: phase * 100 + 1,
      trials: phase, failures: 0, sampling: "unsampled" },
    policy: { baselineVersion: "old", candidateVersion: "new", phaseStartedAt: phase * 100,
      baselineWindow: { from: 0, to: 100 }, minTrials: 20, maxErrorRate: .1, maxIncrease: .05, alpha: .05, comparisons: 4 },
    margins: { maxErrorRate: .1, maxIncrease: .05, errorGuardBand: .02, increaseGuardBand: .01 },
    decision: { status: "uncertain", reason: "more data", baseline: { rate: 0, low: 0, high: .2 },
      candidate: { rate: 0, low: 0, high: .5 }, increase: { low: -.2, high: .5 } },
    route: { status: "review", reason: "more data" } }
}

test("host health observer updates the owned card with cumulative history, no separate message", async () => {
  const card = new RunCard({ instanceId: "run", repository: "owner/repo", revision: "abcdef123" })
  card.update({ type: "step.status", workflowId: "health-mediated-approval", stepId: "release", status: "running",
    optional: false, timestamp: "now" })
  const checkpoints = new Map<string, unknown>()
  const step = { do: async (name: string, _options: unknown, body: () => Promise<unknown>) => {
    if (!checkpoints.has(name)) checkpoints.set(name, await body())
    return checkpoints.get(name)
  } } as unknown as WorkflowStep
  const histories: number[][] = []
  const frames: ReturnType<RunCard["render"]>[] = []
  let uploads = 0
  const receipt = { ts: "existing-ci-message" }
  const observe = hmdCardObserver("run", step, card, {
    render: async (points) => { histories.push(points.map((point) => point.elapsedSeconds)); return new Uint8Array([1]) },
    upload: async () => { uploads++; return uploads === 2 ? { ok: false } : { ok: true, fileId: `F${uploads}` } },
    publish: async (owned) => { assert.equal(owned, card); assert.equal(receipt.ts, "existing-ci-message"); frames.push(owned.render()) },
  })
  const history: HmdObservation[] = []
  for (const phase of [10, 25, 75, 100] as const) {
    history.push(observation(phase))
    await observe({ type: "observed", observations: history })
  }
  assert.deepEqual(histories.map((points) => points.length), [1, 2, 3, 4])
  assert.deepEqual(histories.at(-1), [1.001, 2.501, 7.501, 10.001])
  assert.equal(uploads, 4)
  assert.equal(frames[0]!.blocks.filter((b) => b.type === "image").length, 1)
  assert.equal(frames[1]!.blocks.filter((b) => b.type === "image").length, 0, "failed image cannot leave an old phase graph")
  assert.ok(frames.every((frame) => JSON.stringify(frame).includes("HTTP cohort (not WOBS)")))
  assert.ok(frames.every((frame) => JSON.stringify(frame).includes("uncertain")))
  assert.ok(frames.every((frame) => JSON.stringify(frame).includes("release — running")))
  await observe({ type: "observed", observations: history })
  assert.equal(uploads, 4, "native receipt replay does not upload again")
  await observe({ type: "settled", observation: history.at(-1)!, basis: "human-risk-acceptance" })
  assert.equal(card.snapshot().health?.decision, "uncertain")
  assert.equal(frames.length, 5)
})

test("native controller feeds each pinned observation to the same card before approval", async () => {
  const baselineVersion = "09593237-23b2-4873-bd04-88c8e8488840"
  const candidateVersion = "c94cee12-0bf4-48fb-bb42-9235f7ab7a3c"
  const card = new RunCard({ instanceId: "run", repository: "owner/repo", revision: "abcdef123" })
  let activeCheckpoint = false
  let current: HmdObservation | undefined
  let rendered = 0
  let published = 0
  let restored = 0
  const step = {
    do: async (_name: string, _options: unknown, body: () => Promise<unknown>) => {
      assert.equal(activeCheckpoint, false)
      activeCheckpoint = true
      try { return await body() } finally { activeCheckpoint = false }
    },
    waitForEvent: async () => {
      assert.equal(published, rendered)
      assert.equal(card.snapshot().health!.phase, current!.phase)
      assert.equal(card.snapshot().health!.decision, "uncertain")
      return { payload: { snapshot: current!.snapshot, decision: "approved", reason: "Test-only administrative risk acceptance" } }
    },
  } as unknown as WorkflowStep
  const bridge = hmdCardObserver("run", step, card, {
    render: async (points) => {
      rendered++
      assert.equal(points.length, rendered)
      assert.ok(points.every((point, i) => i === 0 || point.elapsedSeconds > points[i - 1]!.elapsedSeconds))
      return new Uint8Array([1])
    },
    upload: async () => ({ ok: true, fileId: `F${rendered}` }),
    publish: async (owned) => { assert.equal(owned, card); published++ },
  })
  const journal = { previous: [{ version: baselineVersion, percentage: 100 }], deployment: { id: "baseline-restored" } }
  const broker = { begin: async () => journal, renew: async () => journal,
    promote: async () => journal, rollback: async () => { restored++; return journal } } as unknown as Parameters<typeof runHumanReviewedHmd>[2]
  const result = await runHumanReviewedHmd("run", step, broker, async (_origin, identity) => ({
    requested: 100, unknown: 0, outcomes: Array.from({ length: 100 }, () => ({
      version: identity.endsWith("baseline") ? baselineVersion : candidateVersion, healthy: true })),
  }), undefined, async (update) => {
    if (update.type === "observed") current = update.observations.at(-1)
    await bridge(update)
  })
  assert.equal(rendered, 4)
  assert.equal(published, 4)
  assert.equal(restored, 1)
  assert.equal(result.releaseCommitted, false)
  assert.ok(result.observations.every((o) => o.basis === "human-risk-acceptance" && o.decision.status === "uncertain"))
})

test("mixed identity/history is rejected before render, upload or publish", async () => {
  const card = new RunCard({ instanceId: "run", repository: "repo", revision: "main" })
  const forbidden = async (): Promise<never> => { throw new Error("Must not call transport") }
  const observe = hmdCardObserver("run", {} as WorkflowStep, card, { render: forbidden, upload: forbidden, publish: forbidden })
  await assert.rejects(observe({ type: "observed", observations: [{ ...observation(10), owner: "other" }] }), /identity/)
  await assert.rejects(observe({ type: "observed", observations: [observation(25), observation(10)] }), /history/)
  await assert.rejects(observe({ type: "observed", observations: [observation(10),
    { ...observation(25), baseline: { ...observation(25).baseline, from: 1 } }] }), /history/)
})
