import { Files, SandboxFileError } from "@cloudflare/sandbox"
import * as CI from "@effect-ci-testbed/ci"
import {
  DurableObject,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig as CloudflareWorkflowStepConfig,
} from "cloudflare:workers"
import * as Effect from "effect/Effect"

const decoder = new TextDecoder()
const defaultImage = "workspace"
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
  readonly getCachedSnapshot: (
    key: string,
  ) => Promise<ContainerSnapshotValue | undefined>
  readonly putCachedSnapshot: (
    key: string,
    snapshot: ContainerSnapshotValue,
  ) => Promise<void>
  readonly checkout: (
    repository: string,
    revision: string,
    targetDirectory: string,
    options?: WorkspaceContainerOptions,
    token?: string,
  ) => Promise<void>
  readonly checkpoint: (
    name: string,
    release?: boolean,
  ) => Promise<ContainerSnapshotValue>
  readonly execute: (
    command: string,
    cwd: string,
    stepId: string,
    revision?: ContainerSnapshotValue,
    cachePaths?: ReadonlyArray<string>,
    cacheRoot?: string,
  ) => Promise<ContainerExecutionResult>
  readonly exists: (
    path: string,
    cwd: string,
    stepId: string,
    revision?: ContainerSnapshotValue,
  ) => Promise<boolean>
  readonly readFile: (
    path: string,
    cwd: string,
    stepId: string,
    revision?: ContainerSnapshotValue,
  ) => Promise<string | undefined>
  readonly restore: (snapshot: ContainerSnapshotValue) => Promise<void>
}

export interface WorkspaceContainerOptions {
  readonly image?: string
  readonly instance?: "lite" | "standard-1" | "standard-2" | "standard-3" | "standard-4"
}

interface WorkspaceContainerEnvironment {}

export class WorkspaceContainer extends DurableObject<WorkspaceContainerEnvironment> {
  private activeStepId: string | undefined
  private dirty = false
  private readonly files: Files
  private workingCheckpointId: string | undefined

  constructor(
    state: DurableObjectState,
    environment: WorkspaceContainerEnvironment,
  ) {
    super(state, environment)
    const container = state.container

    if (!container) {
      throw new Error("No Container is configured for this Durable Object")
    }

    this.files = new Files(container)
  }

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
      this.workingCheckpointId = activeCheckpoint.id
      this.dirty = false

      return
    }

    const imageName = options.image ?? defaultImage
    const configuredImage = container.images[imageName]

    container.start({
      image: configuredImage ?? imageName,
      instance: options.instance ?? "lite",
      entrypoint: ["sleep", "infinity"],
      enableInternet: true,
    })
  }

  private async materialize(
    stepId: string,
    revision?: ContainerSnapshotValue,
  ): Promise<void> {
    if (this.activeStepId === stepId) {
      await this.ensureRunning()
      return
    }

    if (!revision) {
      await this.ensureRunning()
      this.activeStepId = stepId
      return
    }

    const container = this.container()
    const canReuse = container.running &&
      this.workingCheckpointId === revision.id &&
      !this.dirty

    if (!canReuse) {
      await this.ctx.storage.put("activeCheckpoint", revision)

      if (container.running) {
        await container.destroy(`Materializing workspace revision ${revision.id}`)
      }

      container.start({
        containerSnapshot: revision,
        enableInternet: true,
      })
      this.workingCheckpointId = revision.id
      this.dirty = false
    }

    this.activeStepId = stepId
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

  async getCachedSnapshot(key: string): Promise<ContainerSnapshotValue | undefined> {
    return this.ctx.storage.get<ContainerSnapshotValue>(`cache:${key}`)
  }

  async putCachedSnapshot(
    key: string,
    snapshot: ContainerSnapshotValue,
  ): Promise<void> {
    await this.ctx.storage.put(`cache:${key}`, snapshot)
  }

  async checkout(
    repository: string,
    revision: string,
    targetDirectory = defaultTargetDirectory,
    options: WorkspaceContainerOptions = {},
    token?: string,
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
      const authentication = token
        ? ["-c", `http.extraHeader=Authorization: Basic ${btoa(`x-access-token:${token}`)}`]
        : []
      const clone = await this.run([
        "git",
        ...authentication,
        "clone",
        "--no-checkout",
        repository,
        targetDirectory,
      ])

      if (clone.exitCode !== 0) {
        throw new Error(clone.stderr || clone.stdout || "git clone failed")
      }
    }

    const authentication = token
      ? ["-c", `http.extraHeader=Authorization: Basic ${btoa(`x-access-token:${token}`)}`]
      : []
    const fetch = await this.run([
      "git",
      ...authentication,
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

  async execute(
    command: string,
    cwd: string,
    stepId: string,
    revision?: ContainerSnapshotValue,
    cachePaths: ReadonlyArray<string> = [],
    cacheRoot = cwd,
  ): Promise<ContainerExecutionResult> {
    await this.materialize(stepId, revision)
    this.dirty = true

    const paths = cachePaths.map((path) => {
      if (path.startsWith("/") || path.split("/").includes("..")) {
        throw new Error(`Cache path must be relative to the workspace: ${path}`)
      }

      return `${cacheRoot}/${path}`
    })
    const backups = paths.map((_, index) => `/tmp/effect-ci-cache/${index}`)

    for (const [index, path] of paths.entries()) {
      await this.run(["rm", "-rf", backups[index]!])
      const exists = await this.run(["test", "-e", path])

      if (exists.exitCode === 0) {
        await this.run(["mkdir", "-p", "/tmp/effect-ci-cache"])
        await this.run(["cp", "-a", path, backups[index]!])
      }
    }

    const result = await this.run(["sh", "-lc", command], cwd)

    for (const [index, path] of paths.entries()) {
      const exists = await this.run(["test", "-e", path])
      const backupExists = await this.run(["test", "-e", backups[index]!])

      if (exists.exitCode !== 0 && backupExists.exitCode === 0) {
        const parent = path.slice(0, path.lastIndexOf("/"))
        await this.run(["mkdir", "-p", parent])
        await this.run(["cp", "-a", backups[index]!, path])
      }

      await this.run(["rm", "-rf", backups[index]!])
    }

    return result
  }

  async readFile(
    path: string,
    cwd: string,
    stepId: string,
    revision?: ContainerSnapshotValue,
  ): Promise<string | undefined> {
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`Workspace path must be relative: ${path}`)
    }

    await this.materialize(stepId, revision)

    try {
      const response = await this.files.readFile(path, { cwd })

      return response.text()
    } catch (error) {
      if (SandboxFileError.is(error) && error.code === "ENOENT") return undefined
      throw error
    }
  }

  async exists(
    path: string,
    cwd: string,
    stepId: string,
    revision?: ContainerSnapshotValue,
  ): Promise<boolean> {
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`Workspace path must be relative: ${path}`)
    }

    await this.materialize(stepId, revision)

    try {
      await this.files.stat(path, { cwd })

      return true
    } catch (error) {
      if (SandboxFileError.is(error) && error.code === "ENOENT") return false
      throw error
    }
  }

  async checkpoint(
    name: string,
    release = false,
  ): Promise<ContainerSnapshotValue> {
    const snapshot = await this.container().snapshotContainer({ name })

    await this.ctx.storage.put({
      activeCheckpoint: snapshot,
      [`checkpoint:${name}`]: snapshot,
    })
    this.activeStepId = undefined
    this.dirty = false
    this.workingCheckpointId = snapshot.id

    if (release) {
      await this.container().destroy(`Releasing committed workspace ${snapshot.id}`)
    }

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
    this.activeStepId = undefined
    this.dirty = false
    this.workingCheckpointId = snapshot.id
  }
}

export interface RunnerOptions {
  readonly binding: DurableObjectNamespace
  readonly cache?: {
    readonly key: string
    readonly paths?: ReadonlyArray<string>
  }
  readonly container?: WorkspaceContainerOptions
  readonly repository: string
  readonly root?: string
  readonly reuseWorkspace?: boolean
  readonly revision: string
  readonly step: WorkflowStep
  readonly targetDirectory?: string
  readonly token?: string | (() => Promise<string>)
  readonly workspaceId: string
}

export interface Runner {
  readonly executor: CI.CommandExecutor
  readonly fileSystem: CI.WorkspaceFileSystem
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

export interface WorkflowEntrypointOptions<Environment extends WorkflowEnvironment = WorkflowEnvironment> {
  readonly cache?: CI.WorkspaceCachePolicy | false
  readonly container?: WorkspaceContainerOptions
  readonly reuseWorkspace?: boolean
  /** Project directory within the checked-out repository. */
  readonly root?: string
  readonly secrets?: (environment: Environment) => CI.SecretResolver
  readonly checkCache?: (environment: Environment) => CI.CheckCache
}

export const makeRunner = (options: RunnerOptions): Runner => {
  const primary = options.binding.getByName(options.workspaceId) as unknown as WorkspaceContainerStub
  const containerFor = (
    stepId: string,
    workspace?: CI.Workspace,
  ): WorkspaceContainerStub => workspace?.revision
    ? options.binding.getByName(
        `${options.workspaceId}:step=${stepId}`,
      ) as unknown as WorkspaceContainerStub
    : primary
  const cache = options.cache
    ? options.binding.getByName(
        `cache:${options.cache.key}:image=${options.container?.image ?? defaultImage}`,
      ) as unknown as WorkspaceContainerStub
    : undefined
  const targetDirectory = options.targetDirectory ?? defaultTargetDirectory

  return {
    source: {
      checkout: () => Effect.tryPromise({
        try: async () => {
          if (cache) {
            const snapshot = await options.step.do("workspace-cache:restore", () =>
              cache.getCachedSnapshot("latest"))

            if (snapshot) {
              await options.step.do("workspace-cache:materialize", () =>
                primary.restore(snapshot))
            }
          }

          await options.step.do("checkout", async () => {
            const token = typeof options.token === "function"
              ? await options.token()
              : options.token

            await primary.checkout(
              options.repository,
              options.revision,
              targetDirectory,
              options.container,
              token,
            )
          })

          const cwd = options.root
            ? `${targetDirectory}/${options.root}`
            : targetDirectory

          return CI.Workspace.remote(options.workspaceId, cwd)
        },
        catch: (error) => error,
      }),
    },
    executor: {
      handlesStepOptions: true,
      execute: ({ command, onOutput, options: stepOptions, stepId, workspace }) => Effect.tryPromise({
        try: async () => {
          if (workspace.kind !== "remote" || workspace.id !== options.workspaceId) {
            throw new Error(`Workspace ${workspace.cwd} does not belong to this Container`)
          }

          const revision = workspace.revision
          if (revision && revision.provider !== "cloudflare-container") {
            throw new Error(`Cannot materialize ${revision.provider} with Cloudflare`)
          }

          const container = containerFor(stepId, workspace)
          const nativeStepOptions = {
            ...(stepOptions.retries ? { retries: stepOptions.retries } : {}),
            ...(stepOptions.timeout === undefined ? {} : { timeout: stepOptions.timeout }),
          } as CloudflareWorkflowStepConfig
          const result = await options.step.do(
            stepId,
            nativeStepOptions,
            () => container.execute(
              command,
              workspace.cwd,
              stepId,
              revision?.value as ContainerSnapshotValue | undefined,
              options.cache?.paths,
              targetDirectory,
            ),
          )

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
    fileSystem: {
      exists: (workspace, path, stepId) => Effect.tryPromise({
        try: async () => {
          if (workspace.kind !== "remote" || workspace.id !== options.workspaceId) {
            throw new Error(`Workspace ${workspace.cwd} does not belong to this Container`)
          }

          const revision = workspace.revision
          if (revision && revision.provider !== "cloudflare-container") {
            throw new Error(`Cannot materialize ${revision.provider} with Cloudflare`)
          }

          const pathId = path.replaceAll(/[^a-zA-Z0-9_-]/g, "-")
          const container = containerFor(stepId, workspace)

          return options.step.do(`${stepId}:exists-${pathId}`, () =>
            container.exists(
              path,
              workspace.cwd,
              stepId,
              revision?.value as ContainerSnapshotValue | undefined,
            ))
        },
        catch: (error) => error,
      }),
      readFile: (workspace, path, stepId) => Effect.tryPromise({
        try: async () => {
          if (workspace.kind !== "remote" || workspace.id !== options.workspaceId) {
            throw new Error(`Workspace ${workspace.cwd} does not belong to this Container`)
          }

          const revision = workspace.revision
          if (revision && revision.provider !== "cloudflare-container") {
            throw new Error(`Cannot materialize ${revision.provider} with Cloudflare`)
          }

          const pathId = path.replaceAll(/[^a-zA-Z0-9_-]/g, "-")
          const container = containerFor(stepId, workspace)

          return options.step.do(`${stepId}:read-${pathId}`, () =>
            container.readFile(
              path,
              workspace.cwd,
              stepId,
              revision?.value as ContainerSnapshotValue | undefined,
            ))
        },
        catch: (error) => error,
      }),
    },
    persistence: {
      commit: ({ stepId, workspace }) => Effect.tryPromise({
        try: async () => {
          if (workspace.kind !== "remote" || workspace.id !== options.workspaceId) {
            throw new Error(`Workspace ${workspace.cwd} does not belong to this Container`)
          }

          const container = containerFor(stepId, workspace)
          const snapshot = await options.step.do(`${stepId}:commit`, () =>
            container.checkpoint(
              `${stepId}-workspace`,
              options.reuseWorkspace === false,
            ))

          if (cache) {
            await options.step.do(`${stepId}:cache`, () =>
              cache.putCachedSnapshot("latest", snapshot))
          }

          const revision: CI.WorkspaceCheckpointHandle = {
            provider: "cloudflare-container",
            value: snapshot,
          }

          return workspace.withRevision(revision)
        },
        catch: (error) => error,
      }),
      checkpoint: ({ name, stepId, workspace }) => Effect.tryPromise({
        try: async () => {
          if (workspace.kind !== "remote" || workspace.id !== options.workspaceId) {
            throw new Error(`Workspace ${workspace.cwd} does not belong to this Container`)
          }

          const container = containerFor(stepId, workspace)
          const checkpointId = name.replaceAll(/[^a-zA-Z0-9_-]/g, "-")
          const snapshot = await options.step.do(`${stepId}:checkpoint-${checkpointId}`, () =>
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

          const container = containerFor(stepId, checkpoint.workspace)
          await options.step.do(`${stepId}:restore`, () =>
            container.restore(checkpoint.handle.value as ContainerSnapshotValue))

          return checkpoint.workspace
        },
        catch: (error) => error,
      }),
    },
  }
}

export const workflowEntrypoint = <
  A,
  Environment extends WorkflowEnvironment = WorkflowEnvironment,
>(
  workflow: CI.Workflow<A>,
  options: WorkflowEntrypointOptions<Environment> = {},
) => class EffectCIWorkflow extends WorkflowEntrypoint<
  Environment,
  WorkflowParameters
> {
  override async run(
    event: Readonly<WorkflowEvent<WorkflowParameters>>,
    step: WorkflowStep,
  ) {
    const cache = options.cache === false ? undefined : options.cache
    const runner = makeRunner({
      binding: this.env.Workspace,
      ...(cache
        ? {
            cache: {
              key: cache.key,
              paths: cache.paths,
            },
          }
        : {}),
      ...(options.container ? { container: options.container } : {}),
      repository: event.payload.repository,
      ...(options.root ? { root: options.root } : {}),
      ...(options.reuseWorkspace === undefined
        ? {}
        : { reuseWorkspace: options.reuseWorkspace }),
      revision: event.payload.revision,
      step,
      workspaceId: event.instanceId,
    })

    const result = await CI.runPromise(workflow, {
      ci: true,
      env: "cloudflare",
      event: {
        type: "workflow_dispatch",
        payload: event.payload,
        revision: event.payload.revision,
        source: {
          repository: event.payload.repository,
          revision: event.payload.revision,
        },
      },
      executor: runner.executor,
      output: "silent",
      ...(options.secrets ? { secrets: options.secrets(this.env) } : {}),
      source: runner.source,
      ...(options.checkCache
        ? { checkCache: options.checkCache(this.env) }
        : {}),
      workspaceFileSystem: runner.fileSystem,
      workspacePersistence: runner.persistence,
    })

    return result.plan
  }
}
