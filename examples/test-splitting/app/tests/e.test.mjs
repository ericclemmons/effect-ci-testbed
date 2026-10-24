import assert from "node:assert/strict"
import test from "node:test"
import { setTimeout } from "node:timers/promises"

test("case e", async () => {
  await setTimeout(10)
  assert.notEqual(process.env.FAIL_TEST, "e", "Intentional shard failure")
  assert.equal(4 + 1, 5)
})
