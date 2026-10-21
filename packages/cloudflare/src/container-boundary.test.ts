import assert from "node:assert/strict"
import test from "node:test"
import * as Schema from "effect/Schema"
import { ContainerBoundary, containerFailure } from "./container-boundary.ts"

test("container diagnostics admit only closed provider classifications, never arbitrary causes", () => {
  assert.deepEqual(containerFailure({ name: "TypeError", code: "ECONNRESET", status: 502,
    message: "private-token", stack: "private-handle", command: "private-command" }),
    { errorName: "TypeError", errorCode: "ECONNRESET", httpStatus: 502 })
  assert.deepEqual(containerFailure({ name: "private-token", code: "private-handle", status: 600 }), {})
  assert.deepEqual(containerFailure({ get name() { throw Error("private-getter") } }), {})
  assert.deepEqual(containerFailure("private-cause"), {})
  const event = Schema.decodeUnknownSync(ContainerBoundary)({ scope: "command", phase: "output", state: "failed", running: true,
    ...containerFailure(Error("private-token")), message: "private-token" })
  assert.deepEqual(event, { scope: "command", phase: "output", state: "failed", running: true, errorName: "Error" })
})
