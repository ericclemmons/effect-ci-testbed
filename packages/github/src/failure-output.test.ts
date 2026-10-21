import assert from "node:assert/strict"
import test from "node:test"
import * as Effect from "effect/Effect"
import * as CI from "@effect-ci-testbed/ci"
import { Reporter } from "./reporter.ts"
import type { UpdateCheckOptions } from "./index.ts"

for (const mode of ["exit", "unavailable"] as const) test(`GitHub retains ${mode} diagnostics from the actual workflow`, async () => {
  const updates: UpdateCheckOptions[] = []
  let count = 0, executions = 0
  const reporter = new Reporter({ token: "private-fixture-token", repository: "owner/repo", sha: "a".repeat(40) }, {
    createCheck: async () => ({ id: ++count, htmlUrl: `https://github.com/owner/repo/runs/${count}` }),
    updateCheck: async update => { updates.push(update); return { id: update.checkId, htmlUrl: "https://github.com/owner/repo/runs/1" } },
  })
  const action = CI.action<void>("test", () => function* () { yield* CI.Workspace.local("/fixture").exec("node --test") })
  await assert.rejects(CI.runPromise(CI.workflow("failure-output", () => action()), {
    output: "silent", onEvent: event => reporter.report(event),
    executor: { execute: () => {
      executions++
      return Effect.fail(mode === "exit"
        ? new CI.CommandError("test", "node --test", "/fixture", 7, undefined,
          { stdout: "Expected hello\nReceived goodbye\nprivate-fixture-token", stderr: "assertion failed\n```\nnot a heading", truncated: false })
        : new CI.CommandExecutionError("test", "node --test", "/fixture"))
    } },
  }))
  const final = updates.filter(update => update.conclusion === "failure").at(-1)!
  assert.ok(final.text)
  assert.ok(final.text.indexOf("Failure details") < final.text.indexOf("Execution graph"), "the failure belongs above the diagram")
  if (mode === "exit") {
    assert.ok(final.text.includes("Expected hello\nReceived goodbye"))
    assert.ok(final.text.includes("assertion failed"))
    assert.ok(final.text.includes("exit 7"))
    assert.ok(!final.text.includes("private-fixture-token"))
  } else {
    assert.ok(final.text.includes("container-execution"))
    assert.ok(final.text.includes("Process exit unknown"))
    assert.ok(final.text.includes("No stdout or stderr was captured"))
    assert.ok(final.text.includes("Do not rerun automatically"))
    assert.ok(!final.text.includes("exit 1"))
  }
  assert.equal(executions, 1)
})
