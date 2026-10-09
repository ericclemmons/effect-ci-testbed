import * as CI from "@effect-ci-testbed/ci"
import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers"

/** The native checkpoint must see a command failure before it records success. */
export const executeCommandStep = async (
  step: Pick<WorkflowStep, "do">,
  request: Pick<CI.CommandExecutionRequest, "command" | "stepId" | "workspace" | "options">,
  execute: () => Promise<CI.CommandExecutionResult>,
): Promise<CI.CommandExecutionResult> => {
  const config = {
    retries: request.options.retries ?? { limit: 0, delay: 0, backoff: "constant" },
    ...(request.options.timeout === undefined ? {} : { timeout: request.options.timeout }),
  } as WorkflowStepConfig
  return step.do(request.stepId, config, async () => {
    const result = await execute()
    if (result.exitCode !== 0) {
      throw new CI.CommandError(request.stepId, request.command, request.workspace.cwd,
        result.exitCode, result.stderr || result.stdout)
    }
    return result
  }).catch((error: unknown) => {
    if (error instanceof CI.CommandError) throw error
    // Workflow failures cross a serialization boundary. Restore command error
    // metadata from our own exact message format rather than replacing exit 7
    // (or its stderr) with a generic exit 1.
    const message = error instanceof Error ? error.message : ""
    const match = /^Command failed \((\d+)\): /.exec(message)
    if (match) {
      const prefix = `${match[0]}${request.command}`
      if (message === prefix || message.startsWith(`${prefix}\n`)) {
        throw new CI.CommandError(request.stepId, request.command, request.workspace.cwd,
          Number(match[1]), message.slice(prefix.length).trimStart() || undefined)
      }
    }
    throw error
  })
}
