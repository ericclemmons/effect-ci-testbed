import * as CI from "@effect-ci-testbed/ci"
import type { WorkflowStep } from "cloudflare:workers"
import type { RecordedCommandResult } from "./index.ts"
import { commandFailure, nativeCommandError, restoreCommandError } from "./command-error.ts"
import { commandCheckpointError } from "./action-checkpoint-error.ts"

type Request = Pick<CI.CommandExecutionRequest, "command" | "stepId" | "workspace" | "options">
export interface RecordedCommandBackend {
  /** Never repeated after any acknowledgement, including a failed one. */
  launch(): Promise<boolean>
  /** Must acquire a fresh stub; reads only the original execution identity. */
  result(): Promise<RecordedCommandResult>
}

function timeoutMillis(timeout: CI.WorkflowDuration = "10 minutes"): number {
  if (typeof timeout === "number") return timeout
  const match = /^(\d+(?:\.\d+)?) (second|minute|hour|day|week)s?$/.exec(timeout)
  if (!match) throw Error("Invalid command timeout")
  const units: Record<string, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }
  return Number(match[1]) * units[match[2]!]!
}

/** The Workflow never holds a single long-lived command RPC. Short, durable
 * observations can reconnect to a replacement DO without launching again. */
export async function executeRecordedCommandStep(step: Pick<WorkflowStep, "do" | "sleep">, request: Request,
  name: string, backend: RecordedCommandBackend): Promise<CI.CommandExecutionResult | undefined> {
  const policy = { retries: { limit: 0, delay: "1 second" as const } }
  const deadline = await step.do(`${name}:deadline`, policy, async () => Date.now() + timeoutMillis(request.options.timeout))
  if (Date.now() >= deadline) throw new CI.CommandExecutionError(request.stepId, request.command, request.workspace.cwd)
  try {
    const supported = await step.do(`${name}:launch`, { ...policy, timeout: Math.max(1, deadline - Date.now()) }, () => backend.launch())
    if (!supported) return undefined
  } catch {
    // Lost launch ACK is not proof of no launch. Only read/reconcile below;
    // a missing launch identity fails closed and never falls back to execute.
  }
  let observation = 0
  while (Date.now() < deadline) {
    let value: RecordedCommandResult | undefined
    for (let connection = 0; connection < 3; connection++) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new CI.CommandExecutionError(request.stepId, request.command, request.workspace.cwd)
      try {
        value = await step.do(`${name}:result:${observation}:${connection}`, { ...policy, timeout: remaining }, async () => {
          const actual = await backend.result()
          if (actual.state === "complete" && actual.result.exitCode !== 0)
            throw nativeCommandError(commandFailure(request, actual.result))
          return actual
        })
        break
      } catch (cause) {
        const error = restoreCommandError(cause, { stepId: request.stepId, command: request.command, cwd: request.workspace.cwd })
        if (error instanceof CI.CommandError) throw error
        if (connection === 2) {
          const checkpoint = commandCheckpointError(error, { ...request, checkpoint: name })
          throw checkpoint instanceof CI.CommandCheckpointError ? checkpoint :
            new CI.CommandExecutionError(request.stepId, request.command, request.workspace.cwd)
        }
        // Repeating a read on a fresh stub is safe even when the preceding
        // Workflow read checkpoint lost its ACK. Never call launch here.
      }
    }
    if (value?.state === "complete") return value.result
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    try { await step.sleep(`${name}:wait:${observation++}`, Math.min(5000, remaining)) }
    catch { throw new CI.CommandCheckpointError(request.stepId, request.command, request.workspace.cwd, name) }
  }
  throw new CI.CommandExecutionError(request.stepId, request.command, request.workspace.cwd)
}
