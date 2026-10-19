import * as CI from "@effect-ci-testbed/ci"

export const commandFailure = (request: { stepId: string; command: string; workspace: { cwd: string } }, result: CI.CommandExecutionResult) => {
  const output = CI.boundedCommandOutput(result.stdout, result.stderr)
  return new CI.CommandError(request.stepId, request.command, request.workspace.cwd, result.exitCode,
    output.stderr || output.stdout || undefined, output)
}
/** Only known project-command diagnostics, never arbitrary host causes. */
export const nativeCommandError = (error: unknown): unknown => {
  if (!(error instanceof CI.CommandError) || !error.output) return error
  const message = CI.encodeCommandDiagnostics({ version: 1, stepId: error.stepId,
    command: error.command, cwd: error.cwd, exitCode: error.exitCode, output: error.output })
  if (message) error.message = message
  return error
}
export const restoreCommandError = (error: unknown, expected: { stepId: string; command?: string; cwd?: string }): unknown => {
  if (expected.command !== undefined && expected.cwd !== undefined) {
    const unknown = new CI.CommandExecutionError(expected.stepId, expected.command, expected.cwd)
    if (error instanceof Error && error.message === unknown.message) return unknown
  }
  const d = CI.decodeCommandDiagnostics(error instanceof Error ? error.message : undefined, expected)
  return d ? new CI.CommandError(d.stepId, d.command, d.cwd, d.exitCode,
    d.output.stderr || d.output.stdout || undefined, d.output) : error
}
