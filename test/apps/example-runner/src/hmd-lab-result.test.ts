import assert from "node:assert/strict"
import test from "node:test"
import { verifyLabRollback, verifyHealthyLab } from "./hmd-lab-result.ts"
import type { ReleaseJournal } from "../../release-manager/src/release-manager.ts"
const restored: Pick<ReleaseJournal, "status" | "deployment"> = { status: "rolled-back", deployment: { id: "restored", versions: [{ version: "old", percentage: 100 }] } }
const uncertain = { status: "uncertain", reason: "missing evidence" } as const
const regression = { status: "regression", reason: "SLO breach" } as const

test("healthy lab requires all four health gates including 100%, followed by exact cleanup", () => {
  const points = [10, 25, 75, 100].map((phase) => ({ phase, decision: { status: "advance", reason: "SLO passed" } as const }))
  verifyHealthyLab(points, restored, "old")
  assert.throws(() => verifyHealthyLab(points.slice(0, 3), restored, "old"), /missing/)
  assert.throws(() => verifyHealthyLab([...points, { phase: 100, decision: uncertain }], restored, "old"), /missing/)
  assert.throws(() => verifyHealthyLab(points, restored, "wrong"), /allocation/)
})

test("expected rollback requires the expected decision and exact restored allocation", () => {
  verifyLabRollback("regression", "NonRetryableError: Conclusive HMD SLO breach", [uncertain, regression], restored, "old")
  verifyLabRollback("exhaustion", "HMD observation budget exhausted", Array(10).fill(uncertain), restored, "old")
  for (const bad of ["network error", "chart renderer error"]) {
    assert.throws(() => verifyLabRollback("regression", bad, [regression], restored, "old"), /unexpectedly/)
  }
  assert.throws(() => verifyLabRollback("regression", "Conclusive HMD SLO breach", [uncertain], restored, "old"))
  assert.throws(() => verifyLabRollback("exhaustion", "HMD observation budget exhausted", [uncertain], restored, "old"))
  assert.throws(() => verifyLabRollback("exhaustion", "HMD observation budget exhausted", [...Array(9).fill(uncertain), regression], restored, "old"))
  assert.throws(() => verifyLabRollback("regression", "Conclusive HMD SLO breach", [regression], restored, "wrong"), /allocation/)
})
