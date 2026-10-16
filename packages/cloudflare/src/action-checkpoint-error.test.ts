import assert from "node:assert/strict"
import test from "node:test"
import { ActionCheckpointError, actionCheckpointError } from "./action-checkpoint-error.ts"

test("only fixed native checkpoint protocol is translated without leaking remote diagnostics", () => {
  const remote = Object.assign(Error("Attempt failed due to internal workflows error"), {
    name: "WorkflowInternalError", durableObjectId: "private", arbitraryToken: "secret",
  })
  const result = actionCheckpointError(remote, "publish site")
  assert.ok(result instanceof ActionCheckpointError)
  assert.equal(result.stepId, "publish site")
  assert.equal(result.stage, "checkpoint-ack")
  assert.equal(result.effects, "unknown")
  assert.match(result.message, /external effects may already exist/)
  assert.match(result.message, /never retry automatically/)
  assert.doesNotMatch(JSON.stringify(result), /private|secret|durableObjectId/)
  for (const value of [Error("Business failed"), Error("Attempt failed due to internal workflows error: secret"),
    { message: remote.message }, Object.assign(Error(remote.message), { name: "NonRetryableError" })])
    assert.equal(actionCheckpointError(value, "publish site"), value)
  let accessed = false
  const accessor = Error("unused")
  Object.defineProperty(accessor, "message", { get() { accessed = true; throw Error("getter") } })
  assert.equal(actionCheckpointError(accessor, "publish site"), accessor)
  assert.equal(accessed, false)
  class NonRetryableError extends Error {}
  const terminal = new NonRetryableError(remote.message)
  assert.equal(actionCheckpointError(terminal, "publish site"), terminal)
})
