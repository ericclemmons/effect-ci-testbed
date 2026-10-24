import assert from "node:assert/strict"
import test from "node:test"
import { setTimeout } from "node:timers/promises"

test("case b", async () => {
  await setTimeout(100)
  assert.notEqual(process.env.FAIL_TEST, "b", "Intentional shard failure")
  assert.equal(1 + 1, 2)
})
