import assert from "node:assert/strict"
import test from "node:test"
import * as Effect from "effect/Effect"
import * as CI from "./index.ts"

test("a command checkpoint keeps the step deadline without a long-running action checkpoint", async () => {
  let actions = 0
  const commands: CI.WorkflowStepConfig[] = []
  const check = CI.check("test", () => function* () {
    yield* CI.Workspace.local("/fixture").exec("node --test")
  }, { timeout: "30 minutes", checkpoint: "command" })

  const result = await CI.runPromise(CI.workflow("command checkpoint", () => check()), {
    output: "silent",
    actionExecutor: {
      execute: () => {
        actions++
        return Effect.die("command-checkpoint checks must not use an outer action checkpoint")
      },
    },
    executor: {
      handlesStepOptions: true,
      execute: ({ options }) => {
        commands.push(options)
        return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" })
      },
    },
  })

  assert.equal(result.attempt.conclusion, "success")
  assert.equal(actions, 0)
  assert.deepEqual(commands, [{ timeout: "30 minutes" }])
})
