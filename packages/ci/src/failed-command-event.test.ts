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

test("a returned nonzero executor result fails closed before check evidence or dependent actions", async () => {
  const events: CI.RuntimeEvent[] = []
  let records = 0, dependent = false
  const check = CI.check("test", () => function* () {
    yield* CI.Workspace.local("/fixture").exec("pnpm test")
  }, { reuse: { scope: "commit" } })
  const workflow = CI.workflow("adapter-result", function* () {
    yield* check()
    dependent = true
  })
  await assert.rejects(CI.runPromise(workflow, {
    output: "silent", onEvent: event => { events.push(event) },
    executor: { execute: () => Effect.succeed({ exitCode: 7, stdout: "x".repeat(10000), stderr: "assertion failed" }) },
    checkCache: { lookup: () => Effect.succeed(false), record: () => Effect.sync(() => { records++ }) },
  }), /Command failed \(7\)/)
  assert.equal(records, 0)
  assert.equal(dependent, false)
  const failures = events.filter(event => event.type === "step.command.failed")
  assert.equal(failures.length, 1)
  assert.equal(failures[0]!.diagnostics.exitCode, 7)
  assert.equal(failures[0]!.diagnostics.output.stderr, "assertion failed")
  assert.ok(failures[0]!.diagnostics.output.stdout.length <= 8192)
  assert.equal(failures[0]!.diagnostics.output.truncated, true)
})
