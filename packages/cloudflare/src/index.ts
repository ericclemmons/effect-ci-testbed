import * as CI from "@effect-ci-testbed/ci"
import {
  DurableObject,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import * as Effect from "effect/Effect"

const decoder = new TextDecoder()
const defaultImage = "cloudflare/debian-trixie"
const defaultTargetDirectory = "/workspace/repository"

export interface ContainerExecutionResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

export interface ContainerSnapshotValue {
  readonly id: string
  readonly name?: string
  readonly size: number
}

interface WorkspaceContainerStub {
  readonly checkout: (
    repository: string,
    revision: string,
    targetDirectory: string,
    options?: WorkspaceContainerOptions,
  ) => Promise<void>
  readonly checkpoint: (name: string) => Promise<ContainerSnapshotValue>
  readonly execute: (command: string, cwd: string) => Promise<ContainerExecutionResult>
  readonly restore: (snapshot: ContainerSnapshotValue) => Promise<void>
}

export interface WorkspaceContainerOptions {
  readonly image?: string
  readonly instance?: "lite" | "standard-1" | "standard-2" | "standard-3" | "standard-4"
}

export class WorkspaceContainer extends DurableObject {
  private container() {
    const container = this.ctx.container

    if (!container) {
      throw new Error("No Container is configured for this Durable Object")
    }

    return container
  }

  private async ensureRunning(options: WorkspaceContainerOptions = {}): Promise<void> {
    const container = this.container()

    if (container.running) {
      return
    }

    const activeCheckpoint = await this.ctx.storage.get<ContainerSnapshotValue>(
      "activeCheckpoint",
    )

    if (activeCheckpoint) {
      container.start({
        containerSnapshot: activeCheckpoint,
        enableInternet: true,
      })

      return
    }

    const configuredImage = options.image
      ? container.images[options.image]
      : undefined

    container.start({
      image: configuredImage ?? options.image ?? defaultImage,
      instance: options.instance ?? "lite",
      entrypoint: ["sleep", "infinity"],
      enableInternet: true,
    })
  }

  private async run(
    command: ReadonlyArray<string>,
    cwd?: string,
  ): Promise<ContainerExecutionResult> {
    const process = await this.container().exec(
      [...command],
      cwd ? { cwd } : undefined,
    )
    const output = await process.output()

    return {
      exitCode: output.exitCode,
      stderr: decoder.decode(output.stderr),
      stdout: decoder.decode(output.stdout),
    }
  }

  async checkout(
    repository: string,
    revision: string,
    targetDirectory = defaultTargetDirectory,
    options: WorkspaceContainerOptions = {},
  ): Promise<void> {
    await this.ensureRunning(options)

    const git = await this.run(["sh", "-lc", "command -v git"])

    if (git.exitCode !== 0) {
      const installGit = await this.run([
        "sh",
        "-lc",
        "apt-get update && apt-get install --yes --no-install-recommends ca-certificates git",
      ])

      if (installGit.exitCode !== 0) {
        throw new Error(installGit.stderr || installGit.stdout || "git installation failed")
      }
    }

    const existing = await this.run(["test", "-d", `${targetDirectory}/.git`])

    if (existing.exitCode !== 0) {
      const clone = await this.run([
        "git",
        "clone",
        "--no-checkout",
        repository,
        targetDirectory,
      ])

      if (clone.exitCode !== 0) {
        throw new Error(clone.stderr || clone.stdout || "git clone failed")
      }
    }

    const fetch = await this.run([
      "git",
      "-C",
      targetDirectory,
      "fetch",
      "--depth=1",
      "origin",
      revision,
    ])

    if (fetch.exitCode !== 0) {
      throw new Error(fetch.stderr || fetch.stdout || "git fetch failed")
    }

    const checkout = await this.run([
      "git",
      "-C",
      targetDirectory,
      "checkout",
      "--force",
      "FETCH_HEAD",
    ])

    if (checkout.exitCode !== 0) {
      throw new Error(checkout.stderr || checkout.stdout || "git checkout failed")
    }
  }

  async execute(command: string, cwd: string): Promise<ContainerExecutionResult> {
    await this.ensureRunning()

    return this.run(["sh", "-lc", command], cwd)
  }

  async checkpoint(name: string): Promise<ContainerSnapshotValue> {
    const snapshot = await this.container().snapshotContainer({ name })

    await this.ctx.storage.put({
      activeCheckpoint: snapshot,
      [`checkpoint:${name}`]: snapshot,
    })

    return {
      id: snapshot.id,
      ...(snapshot.name ? { name: snapshot.name } : {}),
      size: snapshot.size,
    }
  }

  async restore(snapshot: ContainerSnapshotValue): Promise<void> {
    const container = this.container()

    await this.ctx.storage.put("activeCheckpoint", snapshot)

    if (container.running) {
      await container.destroy(`Restoring workspace checkpoint ${snapshot.id}`)
    }

    container.start({
      containerSnapshot: snapshot,
      enableInternet: true,
    })
  }
}

export interface RunnerOptions {
  readonly binding: DurableObjectNamespace
  readonly container?: WorkspaceContainerOptions
  readonly repository: string
  readonly revision: string
  readonly step: WorkflowStep
  readonly targetDirectory?: string
  readonly workspaceId: string
}

export interface Runner {
  readonly executor: CI.CommandExecutor
  readonly persistence: CI.WorkspacePersistence
  readonly source: CI.SourceService
}

export interface WorkflowParameters {
  readonly repository: string
  readonly revision: string
}

export interface WorkflowEnvironment {
  readonly Workspace: DurableObjectNamespace
}

export interface WorkflowEntrypointOptions {
  readonly container?: WorkspaceContainerOptions
}

export const makeRunner = (options: RunnerOptions): Runner => {
  const container = options.binding.getByName(options.workspaceId) as unknown as WorkspaceContainerStub
  const targetDirectory = options.targetDirectory ?? defaultTargetDirectory

  return {
    source: {
      checkout: (root) => Effect.tryPromise({
        try: async () => {
          await options.step.do("checkout", async () => {
            await container.checkout(
              options.repository,
              options.revision,
              targetDirectory,
              options.container,
            )
          })

          const cwd = root === "." ? targetDirectory : `${targetDirectory}/${root}`

          return CI.Workspace.remote(options.workspaceId, cwd)
        },
        catch: (error) => error,
      }),
    },
    executor: {
      execute: ({ command, onOutput, stepId, workspace }) => Effect.tryPromise({
        try: async () => {
          if (workspace.kind !== "remote" || workspace.id !== options.workspaceId) {
            throw new Error(`Workspace ${workspace.cwd} does not belong to this Container`)
          }

          const result = await options.step.do(stepId, () =>
            container.execute(command, workspace.cwd))

          if (result.stdout) onOutput("stdout", result.stdout)
          if (result.stderr) onOutput("stderr", result.stderr)

          if (result.exitCode !== 0) {
            throw new CI.CommandError(
              stepId,
              command,
              workspace.cwd,
              result.exitCode,
            )
          }

          return result
        },
        catch: (error) => error instanceof CI.CommandError
          ? error
          : new CI.CommandError(stepId, command, workspace.cwd, 1),
      }),
    },
    persistence: {
      checkpoint: ({ name, stepId, workspace }) => Effect.tryPromise({
        try: async () => {
          if (workspace.kind !== "remote" || workspace.id !== options.workspaceId) {
            throw new Error(`Workspace ${workspace.cwd} does not belong to this Container`)
          }

          const snapshot = await options.step.do(`${stepId}:checkpoint`, () =>
            container.checkpoint(name))

          return {
            provider: "cloudflare-container",
            value: snapshot,
          }
        },
        catch: (error) => error,
      }),
      restore: ({ checkpoint, stepId }) => Effect.tryPromise({
        try: async () => {
          if (checkpoint.handle.provider !== "cloudflare-container") {
            throw new Error(`Cannot restore ${checkpoint.handle.provider} with Cloudflare`)
          }

          await options.step.do(`${stepId}:restore`, () =>
            container.restore(checkpoint.handle.value as ContainerSnapshotValue))

          return checkpoint.workspace
        },
        catch: (error) => error,
      }),
    },
  }
}

export const workflowEntrypoint = <A>(
  workflow: CI.Workflow<A>,
  options: WorkflowEntrypointOptions = {},
) => class EffectCIWorkflow extends WorkflowEntrypoint<
  WorkflowEnvironment,
  WorkflowParameters
> {
  override async run(
    event: Readonly<WorkflowEvent<WorkflowParameters>>,
    step: WorkflowStep,
  ) {
    const runner = makeRunner({
      binding: this.env.Workspace,
      ...(options.container ? { container: options.container } : {}),
      repository: event.payload.repository,
      revision: event.payload.revision,
      step,
      workspaceId: event.instanceId,
    })

    const result = await CI.runPromise(workflow, {
      env: "cloudflare",
      event: { type: "workflow_dispatch", payload: event.payload },
      executor: runner.executor,
      source: runner.source,
      workspacePersistence: runner.persistence,
    })

    return result.plan
  }
}
