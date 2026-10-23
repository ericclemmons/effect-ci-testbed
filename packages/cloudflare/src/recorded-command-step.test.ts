import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import { executeRecordedCommandStep } from "./recorded-command-step.ts"

const request = { command: "node --test", stepId: "test", workspace: CI.Workspace.remote("run", "/workspace"), options: {} }
const result = { exitCode: 0, stdout: "the original result", stderr: "" }
const internal = () => Object.assign(Error("Attempt failed due to internal workflows error"), { name: "WorkflowInternalError" })

for (const failure of ["none", "launch-ack", "result-rpc", "result-ack"] as const) {
  test(`recorded command ${failure}: reconnect reads the same execution, never launches twice`, async () => {
    let launches = 0, reads = 0, sleeps = 0, lostAck = false
    const names: string[] = []
    const step = { do: async (name: string, _config: unknown, body: () => Promise<any>) => {
      names.push(name)
      const value = await body()
      if (!lostAck && (failure === "launch-ack" && name.endsWith(":launch") || failure === "result-ack" && name.includes(":result:"))) {
        lostAck = true; throw internal()
      }
      return value
    }, sleep: async () => { sleeps++ } }
    const actual = await executeRecordedCommandStep(step as any, request, 'command:["test",0]', {
      launch: async () => { launches++; return true },
      result: async () => {
        reads++
        if (failure === "result-rpc" && reads === 1) throw Error("Connection closed: this Durable Object instance is no longer active")
        return reads === 1 ? { state: "pending" } : { state: "complete", result }
      },
    })
    assert.deepEqual(actual, result)
    assert.equal(launches, 1)
    assert.ok(reads >= 2)
    assert.ok(sleeps <= 1)
    assert.equal(names.filter(name => name.endsWith(":launch")).length, 1)
  })
}

test("unusable Workflow-engine checkpoint remains failure even when the command may have completed", async () => {
  let launches = 0, reads = 0
  const step = { do: async (name: string, _config: unknown, body: () => Promise<any>) => {
    if (name.endsWith(":deadline")) return body()
    if (name.endsWith(":launch")) await body()
    throw internal()
  }, sleep: async () => { throw Error("No sleep expected") } }
  await assert.rejects(executeRecordedCommandStep(step as any, request, "command:test", {
    launch: async () => { launches++; return true },
    result: async () => { reads++; return { state: "complete", result } },
  }), error => error instanceof CI.CommandCheckpointError && error.processExitCode === null)
  assert.equal(launches, 1)
  assert.equal(reads, 0)
})

test("recovered nonzero output retains the actual failed process exit", async () => {
  let launches = 0, reads = 0
  const step = { do: async (_name: string, _config: unknown, body: () => Promise<any>) => body(), sleep: async () => {} }
  await assert.rejects(executeRecordedCommandStep(step as any, request, "command:test", {
    launch: async () => { launches++; return true },
    result: async () => { reads++; return { state: "complete", result: { exitCode: 7, stdout: "real stdout", stderr: "real failure" } } },
  }), error => error instanceof CI.CommandError && error.exitCode === 7 && error.output?.stderr === "real failure")
  assert.equal(launches, 1); assert.equal(reads, 1)
})

test("a launch with no durable identity fails closed, never falls back to another execute", async () => {
  let launches = 0
  const step = { do: async (_name: string, _config: unknown, body: () => Promise<any>) => body(), sleep: async () => {} }
  await assert.rejects(executeRecordedCommandStep(step as any, request, "command:test", {
    launch: async () => { launches++; throw Error("unknown launch acknowledgement") },
    result: async () => { throw Error("Command execution identity is unavailable") },
  }), CI.CommandExecutionError)
  assert.equal(launches, 1)
})

test("reconnection never extends the original deadline or fabricates a timeout exit", async context => {
  let now = 1000, launches = 0, reads = 0
  context.mock.method(Date, "now", () => now)
  const step = { do: async (_name: string, config: any, body: () => Promise<any>) => {
    if (config.timeout !== undefined) assert.ok(config.timeout <= 11_000 - now)
    return body()
  }, sleep: async (_name: string, delay: number) => { now += delay } }
  await assert.rejects(executeRecordedCommandStep(step as any, { ...request, options: { timeout: "10 seconds" } }, "command:test", {
    launch: async () => { launches++; return true },
    result: async () => { reads++; return { state: "pending" } },
  }), error => error instanceof CI.CommandExecutionError && error.processExitCode === null && !("exitCode" in error))
  assert.equal(now, 11_000); assert.equal(launches, 1); assert.equal(reads, 2)
})
