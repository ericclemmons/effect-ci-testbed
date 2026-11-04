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

export async function executeRecordedCommandStep(step: Pick<WorkflowStep, "do">, request: Request,
  name: string, backend: RecordedCommandBackend): Promise<CI.CommandExecutionResult | undefined> {
  const policy = { retries: { limit: 0, delay: "1 second" as const }, timeout: request.options.timeout ?? "10 minutes" as const }
  try {
    const supported = await step.do(`${name}:launch`, policy, () => backend.launch())
    if (!supported) return undefined
  } catch (error) {
    if (error instanceof CI.CommandExecutionError) throw error
    // Lost launch ACK is not proof of no launch. Only read/reconcile below;
    // a missing launch identity fails closed and never falls back to execute.
  }
  for (let connection = 0; connection < 3; connection++) {
    try {
      return await step.do(`${name}:result:${connection}`, policy, async () => {
        while (true) {
          const actual = await backend.result()
          if (actual.state === "complete") {
            if (actual.result.exitCode !== 0) throw nativeCommandError(commandFailure(request, actual.result))
            return actual.result
          }
          await new Promise(resolve => setTimeout(resolve, 5000))
        }
      })
    } catch (cause) {
      const error = restoreCommandError(cause, { stepId: request.stepId, command: request.command, cwd: request.workspace.cwd })
      if (error instanceof CI.CommandError || error instanceof CI.CommandExecutionError) throw error
      if (connection === 2) {
        const checkpoint = commandCheckpointError(error, { ...request, checkpoint: name })
        throw checkpoint instanceof CI.CommandCheckpointError ? checkpoint :
          new CI.CommandExecutionError(request.stepId, request.command, request.workspace.cwd)
      }
      // Repeating a read on a fresh stub is safe even when the preceding
      // Workflow read checkpoint lost its ACK. Never call launch here.
    }
  }
  throw new CI.CommandExecutionError(request.stepId, request.command, request.workspace.cwd)
}
