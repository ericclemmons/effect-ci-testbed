import assert from "node:assert/strict"
import { test } from "node:test"
import type { WorkflowStep } from "cloudflare:workers"
import type { ReleaseManager, ReleaseJournal } from "../../release-manager/src/release-manager.ts"
import { runHumanReviewedHmd } from "./hmd-review-runner.ts"

const baseline = "09593237-23b2-4873-bd04-88c8e8488840"
const candidate = "c94cee12-0bf4-48fb-bb42-9235f7ab7a3c"

async function lab(mode: "approve" | "reject" | "timeout" | "stale" | "drift" | "regression" | "unknown") {
  const snapshots = new Map<string, { snapshot: string }>()
  const promotions: number[] = []
  let rollbacks = 0
  let reviews = 0
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
      const value = await callback()
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
  }))
  if (mode === "approve") {
    const result = await run
    assert.equal(result.releaseCommitted, false)
    assert.equal(result.wobsVerified, false)
    assert.equal(result.observations.length, 4)
    assert.ok(result.observations.every((snapshot) => snapshot.decision.status === "uncertain" && snapshot.basis === "human-risk-acceptance"))
    assert.equal(new Set(result.observations.map((snapshot) => snapshot.snapshot)).size, 4)
    assert.deepEqual(promotions, [10, 10, 25, 25, 75, 75, 100, 100])
    assert.equal(reviews, 4)
  } else {
    await assert.rejects(run)
    assert.equal(promotions.includes(25), false)
    assert.equal(reviews, ["regression", "unknown"].includes(mode) ? 0 : 1)
  }
  assert.equal(rollbacks, 1)
}

test("each phase requires its own explicit approval without rewriting uncertainty", () => lab("approve"))
for (const mode of ["reject", "timeout", "stale", "drift", "regression", "unknown"] as const) {
  test(`${mode} cannot progress the reviewed canary`, () => lab(mode))
}
