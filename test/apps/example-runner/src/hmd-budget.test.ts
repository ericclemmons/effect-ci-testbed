import assert from "node:assert/strict"
import test from "node:test"
import { assertHmdBudget, maximumProbeRequests, HMD_SUBREQUEST_LIMIT } from "./hmd-budget.ts"

test("healthy lab cannot run under the default subrequest allowance", () => {
  assert.equal(maximumProbeRequests("healthy"), 94_700)
  assert.throws(() => assertHmdBudget(10_000, "healthy"), /recovery headroom/)
  for (const scenario of ["healthy", "regression", "exhaustion"] as const) {
    assert.doesNotThrow(() => assertHmdBudget(HMD_SUBREQUEST_LIMIT, scenario))
  }
})
