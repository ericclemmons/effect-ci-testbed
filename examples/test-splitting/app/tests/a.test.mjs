import assert from "node:assert/strict"
import test from "node:test"
import { setTimeout } from "node:timers/promises"

test("case a", async () => {
  await setTimeout(120)
  assert.notEqual(process.env.FAIL_TEST, "a", "Intentional shard failure")
  assert.equal(0 + 1, 1)
})
