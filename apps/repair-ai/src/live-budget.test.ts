import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"
import { BUDGET_NAME } from "./budget.ts"

/** Read existing evidence only. Never dispatch or spend inference from this test. */
test("recorded native proposal is charged durably without claiming repair", { skip: !process.env.LIVE_REPAIR_BUDGET_INSTANCE }, () => {
  const id = process.env.LIVE_REPAIR_BUDGET_INSTANCE!
  const run = JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", ["workflows", "instances", "get", id,
    "--workflow-name", "effect-ci-repair-budget-probe"], { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 }))
  assert.equal(run.status, "complete")
  assert.equal(run.params.mode, "proposal")
  assert.deepEqual(run.steps.map((entry: any) => entry.name), ["budget:before", "budget:owned-proposal", "budget:after"])
  assert.ok(run.steps.every((entry: any) => entry.success))
  const result = run.output
  assert.equal(result.before.budget, BUDGET_NAME)
  assert.equal(result.after.budget, BUDGET_NAME)
  assert.equal(result.inferenceCalled, true)
  assert.equal(result.patchApplied, false)
  assert.equal(result.flueVerified, false)
  assert.equal(result.repairVerified, false)
  assert.equal(result.after.reservedCents, result.before.reservedCents + 10)
  assert.equal(result.after.remainingCents + result.after.reservedCents, 200)
  assert.equal(result.reservationId, `probe_${id}`)
  assert.equal(result.after.reservations.filter((entry: any) => entry.id === result.reservationId).length, 1)
  assert.ok(!result.before.reservations.some((entry: any) => entry.id === result.reservationId))
  assert.equal(typeof result.proposedText, "string")
  assert.ok(result.proposedText.length > 0)
  assert.ok(!/gh[spr]_[A-Za-z0-9]+|x-access-token:|Bearer /.test(JSON.stringify(run)))
})
