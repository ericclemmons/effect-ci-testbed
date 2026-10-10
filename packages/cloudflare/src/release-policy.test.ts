import { test } from "node:test"
import assert from "node:assert/strict"
import { beginRelease, recordHealth, releaseAllocation } from "./release-policy.ts"

const previous = [{ version: "stable", percentage: 80 }, { version: "older", percentage: 20 }]
test("progressive release preserves the previous split and gates even 100%", () => {
  let state = beginRelease("candidate", previous)
  assert.deepEqual(releaseAllocation(state), [
    { version: "stable", percentage: 72 }, { version: "older", percentage: 18 },
    { version: "candidate", percentage: 10 },
  ])
  for (const percentage of [10, 25, 75, 100]) {
    assert.equal(state.status, "observing")
    assert.equal(releaseAllocation(state).at(-1)!.percentage, percentage)
    assert.ok(Math.abs(releaseAllocation(state).reduce((sum, item) => sum + item.percentage, 0) - 100) < 1e-8)
    state = recordHealth(state, { status: "advance", reason: "within budget" })
  }
  assert.equal(state.status, "complete")
  assert.throws(() => recordHealth(state, { status: "advance", reason: "duplicate" }))
})

test("uncertainty waits; exhaustion and regression restore the entire prior allocation", () => {
  let state = beginRelease("candidate", previous, { maxObservations: 3 })
  state = recordHealth(state, { status: "uncertain", reason: "no cron executions" })
  assert.equal(state.phase, 0)
  assert.equal(state.status, "observing")
  state = recordHealth(state, { status: "advance", reason: "enough evidence" })
  assert.equal(state.phase, 1)
  assert.equal(state.observations, 0)
  const regression = recordHealth(state, { status: "regression", reason: "error rate exceeded" })
  assert.equal(regression.status, "rollback")
  assert.deepEqual(releaseAllocation(regression), previous)
  for (let i = 0; i < 3; i++) state = recordHealth(state, { status: "uncertain", reason: "telemetry arriving" })
  assert.equal(state.status, "rollback")
  assert.match(state.reason!, /exhausted/)
  assert.deepEqual(releaseAllocation(state), previous)
})

test("release rejects corrupt allocations and captures the original mapping by value", () => {
  for (const allocation of [[], [{ version: "stable", percentage: 99 }],
    [{ version: "candidate", percentage: 100 }], [{ version: "stable", percentage: NaN }],
    [{ version: "stable", percentage: 50 }, { version: "stable", percentage: 50 }]]) {
    assert.throws(() => beginRelease("candidate", allocation))
  }
  for (const phases of [[10, 25], [25, 10, 100], [0, 100], [NaN, 100]]) {
    assert.throws(() => beginRelease("candidate", previous, { phases }))
  }
  const mutable = previous.map((entry) => ({ ...entry }))
  const state = beginRelease("candidate", mutable)
  assert.throws(() => recordHealth(state, { status: "unknown", reason: "bad adapter" } as never))
  mutable[0]!.percentage = 1
  const failed = recordHealth(state, { status: "regression", reason: "regression" })
  assert.deepEqual(releaseAllocation(failed), previous)
})
