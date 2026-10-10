import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import workflow from "../workflow.ts"

test("first attempt fails, second succeeds, and each new run retries independently", async () => {
  for (let run = 0; run < 2; run++) {
    const result = await CI.runPromise(workflow, { output: "silent" })
    assert.equal(result.plan.nodes[0]?.status, "complete")
    assert.deepEqual(result.plan.nodes[0]?.options.retries,
      { limit: 1, delay: 1000, backoff: "constant" })
  }
})
