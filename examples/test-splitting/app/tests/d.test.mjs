import assert from "node:assert/strict"
import test from "node:test"
import { setTimeout } from "node:timers/promises"

test("case d", async () => {
  await setTimeout(20)
  assert.notEqual(process.env.FAIL_TEST, "d", "Intentional shard failure")
  assert.equal(3 + 1, 4)
})
