import assert from "node:assert/strict"
import { test } from "node:test"
import type { WorkflowStep } from "cloudflare:workers"
import type { ReleaseManager, ReleaseJournal } from "../../release-manager/src/release-manager.ts"
import { runHumanReviewedHmd, type HmdReviewObserver, type HmdReviewUpdate } from "./hmd-review-runner.ts"

const baseline = "09593237-23b2-4873-bd04-88c8e8488840"
const candidate = "c94cee12-0bf4-48fb-bb42-9235f7ab7a3c"

async function lab(mode: "approve" | "reject" | "timeout" | "stale" | "drift" | "regression" | "unknown" | "observer-failure", observer?: HmdReviewObserver) {
  const snapshots = new Map<string, { snapshot: string }>()
  const promotions: number[] = []
  let rollbacks = 0
  let reviews = 0
  let insideCheckpoint = false
  const updates: HmdReviewUpdate[] = []
  const journal: ReleaseJournal = { owner: "test-owner", candidate,
    previous: [{ version: baseline, percentage: 100 }],
    deployment: { id: "restored", versions: [{ version: baseline, percentage: 100 }] },
    phase: -1, sequence: 0, status: "active" }
  const broker = {
    begin: async () => journal,
    renew: async () => journal,
    promote: async (_: string, phase: number) => {
      if (mode === "drift" && reviews) throw new Error("Deployment ownership drift")
      promotions.push(phase)
      return journal
    },
    rollback: async () => { rollbacks++; return journal },
  } as Pick<ReleaseManager, "begin" | "renew" | "promote" | "rollback">
  const step = {
    do: async (name: string, _options: unknown, callback: () => Promise<unknown>) => {
      assert.equal(insideCheckpoint, false, "native checkpoints cannot nest")
      insideCheckpoint = true
      let value
      try { value = await callback() } finally { insideCheckpoint = false }
      if (name.startsWith("health:snapshot")) snapshots.set(name, value as { snapshot: string })
      if (name.startsWith("review:request")) {
        assert.ok(Buffer.byteLength(JSON.stringify(value)) < 1024, "review identity must fit native step previews")
        assert.match((value as { snapshot: string }).snapshot, /^[a-f0-9]{64}$/)
      }
      return value
    },
    waitForEvent: async (name: string) => {
      reviews++
      if (mode === "timeout") throw new Error("Timed out")
      const phase = name.split("-").at(-1)
      return { payload: { snapshot: mode === "stale" ? "old-phase" : snapshots.get(`health:snapshot-${phase}`)!.snapshot,
        decision: mode === "reject" ? "rejected" : "approved", reason: "Explicit test-only risk acceptance" } }
    },
  } as unknown as WorkflowStep
  const run = runHumanReviewedHmd("test-owner", step, broker, async (_origin, identity) => ({
    requested: 100, unknown: mode === "unknown" && !identity.endsWith("baseline") ? 100 : 0,
    outcomes: Array.from({ length: 100 }, () => ({ version: identity.endsWith("baseline") ? baseline : candidate,
      healthy: identity.endsWith("baseline") || mode !== "regression" })),
  }), undefined, async (update) => {
    assert.equal(insideCheckpoint, false, "observer must execute between native checkpoints")
    assert.ok(Object.isFrozen(update))
    updates.push(update)
    if (update.type === "observed") {
      if (mode === "regression") assert.equal(rollbacks, 1, "regression recovery precedes rendering or notification")
      assert.ok(Object.isFrozen(update.observations))
      assert.ok(Object.isFrozen(update.observations[0]!.decision))
      assert.equal("chart" in update.observations[0]!, false)
      assert.throws(() => Object.assign(update.observations[0]!.decision, { status: "advance" }))
      if (mode === "observer-failure") throw new Error("Required delivery failed")
    }
    await observer?.(update)
  })
  if (mode === "approve") {
    const result = await run
    assert.equal(result.releaseCommitted, false)
    assert.equal(result.wobsVerified, false)
    assert.equal(result.observations.length, 4)
    assert.ok(result.observations.every((snapshot) => snapshot.decision.status === "uncertain" && snapshot.basis === "human-risk-acceptance"))
    assert.equal(new Set(result.observations.map((snapshot) => snapshot.snapshot)).size, 4)
    assert.deepEqual(promotions, [10, 10, 25, 25, 75, 75, 100, 100])
    assert.equal(reviews, 4)
    assert.deepEqual(updates.filter((u) => u.type === "observed").map((u) => u.observations.length), [1, 2, 3, 4])
    assert.equal(updates.filter((u) => u.type === "settled").length, 4)
  } else {
    await assert.rejects(run)
    assert.equal(promotions.includes(25), false)
    assert.equal(reviews, ["regression", "unknown", "observer-failure"].includes(mode) ? 0 : 1)
  }
  assert.equal(rollbacks, 1)
  assert.deepEqual(updates.at(-1), { type: "restored", failed: mode !== "approve" })
}

test("each phase requires its own explicit approval without rewriting uncertainty", () => lab("approve"))
for (const mode of ["reject", "timeout", "stale", "drift", "regression", "unknown", "observer-failure"] as const) {
  test(`${mode} cannot progress the reviewed canary`, () => lab(mode))
}

test("terminal presentation failure cannot trigger another rollback", () => lab("approve", async (update) => {
  if (update.type === "restored") throw new Error("Notification unavailable")
}))

for (const scenario of ["deadline", "wrapped-deadline", "wrong-timeout-duration", "force-regression", "regression-timeout", "unresolved-click", "early-timeout", "transport-error"] as const) {
  test(`explicit progression policy: ${scenario}`, async () => {
    const originalNow = Date.now
    let now = originalNow()
    Date.now = () => now
    let latest: any
    let restored = 0
    let fenced = 0
    const promotions: number[] = []
    const isRegression = scenario.startsWith("regression") || scenario === "force-regression"
    const journal = { previous: [{ version: baseline, percentage: 100 }], deployment: { id: "restored" } }
    const broker = { begin: async () => journal, renew: async () => journal,
      promote: async (_owner: string, phase: number) => { promotions.push(phase); return journal },
      rollback: async () => { restored++; return journal } } as unknown as Parameters<typeof runHumanReviewedHmd>[2]
    const step = { do: async (name: string, _options: unknown, callback: Function) => {
      const result = await callback()
      if (name.startsWith("health:snapshot")) latest = result
      return result
    }, waitForEvent: async (_name: string, options: any) => {
      assert.equal(options.timeout, "2 minutes")
      if (scenario === "force-regression") return { payload: { snapshot: latest.snapshot, decision: "approved", reason: "Automated emergency override fixture" } }
      if (scenario !== "early-timeout") now = latest.expiresAt + 1
      const error = new Error(scenario === "wrapped-deadline" ? "Execution timed out after 120000ms" : scenario === "wrong-timeout-duration" ? "Execution timed out after 1000ms" : "fixture timeout")
      error.name = scenario === "transport-error" ? "TransportError" : ["wrapped-deadline", "wrong-timeout-duration"].includes(scenario) ? "Error" : "WorkflowTimeoutError"
      throw error
    } } as unknown as WorkflowStep
    try {
      const run = runHumanReviewedHmd("progress-fixture", step, broker, async (_origin, identity) => ({ requested: 100, unknown: 0,
        outcomes: Array.from({ length: 100 }, () => ({ version: identity.endsWith("baseline") ? baseline : candidate,
          healthy: identity.endsWith("baseline") || !isRegression })) }), undefined, undefined,
        { autoProgressMinutes: 2, allowRegressionOverride: true, onDeadline: async () => {
          fenced++
          if (scenario === "unresolved-click") throw new Error("Consumed decision delivery is unresolved")
        } })
      if (scenario === "deadline" || scenario === "wrapped-deadline" || scenario === "force-regression") {
        const result = await run
        assert.deepEqual(promotions, [10, 10, 25, 25, 75, 75, 100, 100])
        assert.ok(result.observations.every(o => o.basis === (isRegression ? "human-risk-acceptance" : "deadline-risk-acceptance")))
        assert.ok(result.observations.every(o => o.decision.status === (isRegression ? "regression" : "uncertain")))
        assert.equal(fenced, isRegression ? 0 : 4)
        assert.equal(result.releaseCommitted, false)
      } else {
        await assert.rejects(run)
        assert.deepEqual(promotions, [10], "a regression deadline, unresolved click or non-timeout error cannot progress")
      }
      assert.equal(restored, 1)
    } finally { Date.now = originalNow }
  })
}
