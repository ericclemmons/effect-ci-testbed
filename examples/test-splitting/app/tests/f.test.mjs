import assert from "node:assert/strict"
import test from "node:test"
import { setTimeout } from "node:timers/promises"

test("case f", async () => {
  await setTimeout(10)
  assert.notEqual(process.env.FAIL_TEST, "f", "Intentional shard failure")
  assert.equal(5 + 1, 6)
})
