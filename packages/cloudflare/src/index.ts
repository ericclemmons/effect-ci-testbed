import { getSandbox, type Sandbox } from "@cloudflare/sandbox"
import * as CI from "@effect-ci-testbed/ci"
import type { WorkflowStep } from "cloudflare:workers"
import * as Effect from "effect/Effect"

export interface RunnerOptions {
  readonly binding: DurableObjectNamespace<Sandbox>
  readonly repository: string
  readonly revision: string
  readonly sandboxId: string
  readonly step: WorkflowStep
  readonly targetDirectory?: string
}

export interface Runner {
  readonly executor: CI.CommandExecutor
  readonly source: CI.SourceService
}

export const makeRunner = (options: RunnerOptions): Runner => {
  const sandbox = getSandbox(options.binding, options.sandboxId)
  const targetDirectory = options.targetDirectory ?? "/workspace/repository"

  return {
    source: {
      checkout: (root) => Effect.tryPromise({
        try: async () => {
          await options.step.do("checkout", async () => {
            await sandbox.gitCheckout(options.repository, {
              branch: options.revision,
              targetDir: targetDirectory,
            })
          })

          const cwd = root === "." ? targetDirectory : `${targetDirectory}/${root}`

          return CI.Workspace.remote(options.sandboxId, cwd)
        },
        catch: (error) => error,
      }),
    },
    executor: {
      execute: ({ command, onOutput, stepId, workspace }) => Effect.tryPromise({
        try: async () => {
          if (workspace.kind !== "remote" || workspace.id !== options.sandboxId) {
            throw new Error(`Workspace ${workspace.cwd} does not belong to this sandbox`)
          }

          const result = await options.step.do(stepId, async () =>
            sandbox.exec(command, { cwd: workspace.cwd }))

          if (result.stdout) onOutput("stdout", result.stdout)
          if (result.stderr) onOutput("stderr", result.stderr)

          if (!result.success) {
            throw new CI.CommandError(
              stepId,
              command,
              workspace.cwd,
              result.exitCode,
            )
          }

          return {
            exitCode: result.exitCode,
            stderr: result.stderr,
            stdout: result.stdout,
          }
        },
        catch: (error) => error instanceof CI.CommandError
          ? error
          : new CI.CommandError(stepId, command, workspace.cwd, 1),
      }),
    },
  }
}
