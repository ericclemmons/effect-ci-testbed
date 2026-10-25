import assert from "node:assert/strict"
import test from "node:test"
import { setTimeout } from "node:timers/promises"

test("case c", async () => {
  await setTimeout(80)
  assert.notEqual(process.env.FAIL_TEST, "c", "Intentional shard failure")
  assert.equal(2 + 1, 3)
})
