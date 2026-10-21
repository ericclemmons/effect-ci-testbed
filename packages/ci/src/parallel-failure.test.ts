import assert from "node:assert/strict"
import test from "node:test"
import * as Effect from "effect/Effect"
import * as CI from "./index.ts"

test("parallel actions preserve one typed failure as the original Error, not an array", async () => {
  const original = new CI.CommandExecutionError("test", "node --test", "/fixture")
  let completed = false
  const failed = CI.action<void>("test", () => function* () { yield* Effect.fail(original) })
  const sibling = CI.action<void>("check", () => function* () { completed = true })
  await assert.rejects(CI.runPromise(CI.workflow("parallel", () => CI.parallel([failed(), sibling()])), {
    output: "silent",
  }), error => {
    assert.equal(error, original)
    return true
  })
  assert.equal(completed, true, "validation still waits for independent siblings")
})

test("multiple typed parallel failures have a native-serializable Error message", async () => {
  const originals = [Error("first"), Error("second")]
  const actions = originals.map((error, index) => CI.action<void>(String(index), () => function* () {
    yield* Effect.fail(error)
  }))
  await assert.rejects(CI.runPromise(CI.workflow("parallel", () => CI.parallel(actions.map(action => action()))), {
    output: "silent",
  }), error => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, originals)
    assert.equal(error.message, "2 parallel actions failed. Inspect the failed action checkpoints.")
    return true
  })
})
