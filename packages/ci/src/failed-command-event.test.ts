import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "./index.ts"
import * as Effect from "effect/Effect"

test("a failed command emits both retained streams before failure without retrying execution", async () => {
  const events: CI.RuntimeEvent[] = []
  let executions = 0
  const action = CI.action("test", () => function* () {
    const workspace = CI.Workspace.local("/fixture")
    return yield* workspace.exec("pnpm test")
  })
  const failure = new CI.CommandError("test", "pnpm test", "/fixture", 1, undefined,
    { stdout: "Expected hello\nReceived goodbye\n", stderr: "test assertion failed\n", truncated: false })
  await assert.rejects(CI.runPromise(CI.workflow("cf-ci-demo", () => action()), {
    output: "silent", onEvent: event => { events.push(event) },
    source: { checkout: () => Effect.succeed(CI.Workspace.local("/fixture")) },
    executor: { execute: () => { executions++; return Effect.fail(failure) } },
  }), /Command failed/)
  const diagnostics = events.filter(event => event.type === "step.command.failed")
  assert.equal(diagnostics.length, 1)
  assert.deepEqual(diagnostics[0].diagnostics.output, failure.output)
  assert.equal(diagnostics[0].diagnostics.exitCode, 1)
  assert.equal(executions, 1)
  assert.ok(events.indexOf(diagnostics[0]) < events.findIndex(e => e.type === "step.status" && e.status === "failed"))
})
