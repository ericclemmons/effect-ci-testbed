import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers"
import { executeCommandStep } from "../../../packages/cloudflare/src/command-step.ts"

const request = {
  command: "build",
  stepId: "build",
  workspace: CI.Workspace.remote("test", "/workspace"),
  options: { retries: { limit: 2, delay: 0, backoff: "constant" as const }, timeout: 1000 },
}

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
