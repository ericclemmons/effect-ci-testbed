import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers"
import { executeCommandStep, makeCommandStepExecutor } from "../../../../packages/cloudflare/src/command-step.ts"

const request = {
  command: "build",
  stepId: "build",
  workspace: CI.Workspace.remote("test", "/workspace"),
  options: { retries: { limit: 2, delay: 0, backoff: "constant" as const }, timeout: 1000 },
}

test("lost native command ACK is not a fabricated process exit and does not rerun", async () => {
  let executions = 0
  const step = { async do(_name: string, options: WorkflowStepConfig, callback: () => Promise<CI.CommandExecutionResult>) {
    assert.equal(options.retries?.limit, 0)
    await callback()
    throw Error("Attempt failed due to internal workflows error")
  } } as unknown as Pick<WorkflowStep, "do">
  await assert.rejects(executeCommandStep(step, { ...request, options: {} }, async () => {
    executions++
    return { exitCode: 0, stdout: "effect already happened", stderr: "" }
  }), error => {
    assert.ok(error instanceof CI.CommandCheckpointError)
    assert.equal(error instanceof CI.CommandError, false)
    assert.equal(error.processExitCode, null)
    assert.equal("exitCode" in error, false)
    assert.equal(error.stepId, "build")
    assert.equal(error.checkpoint, "build")
    assert.equal(error.stage, "checkpoint-ack")
    assert.equal(error.effects, "unknown")
    assert.match(error.message, /process exit unknown/)
    assert.doesNotMatch(error.message, /effect already happened/)
    return true
  })
  assert.equal(executions, 1)
})

test("multiple commands in one action have distinct replay-stable checkpoints", async () => {
  const cache = new Map<string, CI.CommandExecutionResult>()
  let calls = 0
  const step = {
    async do(name: string, _options: WorkflowStepConfig, callback: () => Promise<CI.CommandExecutionResult>) {
      if (!cache.has(name)) cache.set(name, await callback())
      return cache.get(name)!
    },
  } as unknown as Pick<WorkflowStep, "do">
  const run = async () => {
    const execute = makeCommandStepExecutor(step)
    const results = []
    for (const command of ["first", "second", "first"]) {
      results.push(await execute({ ...request, command }, async () => {
        calls++
        return { exitCode: 0, stdout: command, stderr: "" }
      }))
    }
    return results.map((result) => result.stdout)
  }
  assert.deepEqual(await run(), ["first", "second", "first"])
  assert.equal(calls, 3)
  assert.equal(cache.size, 3)
  assert.deepEqual(await run(), ["first", "second", "first"])
  assert.equal(calls, 3, "replay restores each command without executing it again")
})

test("check-cache reuse does not renumber later native commands", async () => {
  const names: string[] = []
  const step = {
    async do(name: string, _options: WorkflowStepConfig, callback: () => Promise<CI.CommandExecutionResult>) {
      names.push(name)
      return callback()
    },
  } as unknown as Pick<WorkflowStep, "do">
  const execute = makeCommandStepExecutor(step)
  // The first two commands were verified by the check-cache layer.
  await execute({ ...request, commandIndex: 3 }, async () => ({ exitCode: 0, stdout: "", stderr: "" }))
  assert.deepEqual(names, ['command:["build",3]'])
})

test("command failure reaches the native retry boundary, not its cached result", async () => {
  let attempts = 0
  let config: WorkflowStepConfig | undefined
  const step = {
    async do(_name: string, options: WorkflowStepConfig, callback: () => Promise<CI.CommandExecutionResult>) {
      config = options
      for (let retry = 0; ; retry++) {
        try { return await callback() }
        catch (error) { if (retry >= options.retries!.limit) throw new Error(String((error as Error).message)) }
      }
    },
  } as unknown as Pick<WorkflowStep, "do">
  const result = await executeCommandStep(step, request, async () => {
    attempts++
    return { exitCode: attempts < 3 ? 1 : 0, stderr: "", stdout: `attempt ${attempts}` }
  })
  assert.equal(attempts, 3)
  assert.equal(result.stdout, "attempt 3")
  assert.deepEqual(config, request.options)
})

test("no explicit retry policy means one attempt, matching the local runner", async () => {
  let attempts = 0
  let config: WorkflowStepConfig | undefined
  const step = {
    async do(_name: string, options: WorkflowStepConfig, callback: () => Promise<CI.CommandExecutionResult>) {
      config = options
      return callback()
    },
  } as unknown as Pick<WorkflowStep, "do">
  await assert.rejects(executeCommandStep(step, { ...request, options: {} }, async () => {
    attempts++
    return { exitCode: 7, stderr: "build failed", stdout: "" }
  }), (error) => error instanceof CI.CommandError && error.exitCode === 7)
  assert.equal(attempts, 1)
  assert.equal(config?.retries?.limit, 0)
})

test("exhausted retries preserve the final command failure", async () => {
  let attempts = 0
  const step = {
    async do(_name: string, options: WorkflowStepConfig, callback: () => Promise<CI.CommandExecutionResult>) {
      for (let retry = 0; ; retry++) {
        try { return await callback() }
        catch (error) { if (retry >= options.retries!.limit) throw new Error((error as Error).message) }
      }
    },
  } as unknown as Pick<WorkflowStep, "do">
  await assert.rejects(executeCommandStep(step, request, async () => {
    attempts++
    return { exitCode: 7, stderr: `failure ${attempts}`, stdout: "" }
  }), (error) => error instanceof CI.CommandError && error.exitCode === 7 && error.details === "failure 3")
  assert.equal(attempts, 3)
})

test("native error serialization preserves BOTH bounded output streams without rerunning", async () => {
  let executions = 0
  const step = {
    async do(_name: string, options: WorkflowStepConfig, callback: () => Promise<CI.CommandExecutionResult>) {
      assert.equal(options.retries?.limit, 0)
      try { return await callback() }
      catch (error) { throw new Error((error as Error).message) } // Native message-only boundary.
    },
  } as unknown as Pick<WorkflowStep, "do">
  await assert.rejects(executeCommandStep(step, { ...request, options: {} }, async () => {
    executions++
    return { exitCode: 7, stdout: "compiler context\n", stderr: "missing export\n" }
  }), error => {
    assert.ok(error instanceof CI.CommandError)
    assert.equal(error.exitCode, 7)
    assert.deepEqual(error.output, { stdout: "compiler context\n", stderr: "missing export\n", truncated: false })
    return true
  })
  assert.equal(executions, 1)
})
