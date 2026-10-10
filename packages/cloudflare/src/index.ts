import * as CI from "@effect-ci-testbed/ci"
import {
  DurableObject,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import * as Effect from "effect/Effect"
import { cleanCheckoutCommand } from "./source-checkout.ts"
import { makeCommandStepExecutor } from "./command-step.ts"
import { cacheIdentity } from "./cache-identity.ts"
import { makeActionExecutor } from "./action-step.ts"
import type { SourceFile } from "./artifacts-source.ts"

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
    cachePaths?: ReadonlyArray<string>,
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
    options?: WorkspaceContainerOptions,
  ) => Promise<ContainerExecutionResult>
  readonly exists: (
    path: string,
    cwd: string,
    stepId: string,
    revision?: ContainerSnapshotValue,
    options?: WorkspaceContainerOptions,
  ) => Promise<boolean>
  readonly readFile: (
    path: string,
    cwd: string,
    stepId: string,
    revision?: ContainerSnapshotValue,
    options?: WorkspaceContainerOptions,
  ) => Promise<string | undefined>
  readonly restore: (
    snapshot: ContainerSnapshotValue,
    options?: WorkspaceContainerOptions,
  ) => Promise<void>
}

export interface WorkspaceContainerOptions {
  readonly entrypoint?: ReadonlyArray<string>
  readonly image?: string
  readonly instance?: "lite" | "standard-1" | "standard-2" | "standard-3" | "standard-4"
  /** Command that must succeed before a newly started or restored container is usable. */
  readonly readyCommand?: string
}

interface WorkspaceContainerEnvironment {}

export class WorkspaceContainer extends DurableObject<WorkspaceContainerEnvironment> {
  private activeStepId: string | undefined
  private dirty = false
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
        instance: options.instance ?? "lite",
        entrypoint: [...(options.entrypoint ?? ["sleep", "infinity"])],
        enableInternet: true,
      })
      await this.waitUntilReady(options)
      this.workingCheckpointId = activeCheckpoint.id
      this.dirty = false

      return
    }

    const imageName = options.image ?? defaultImage
    const configuredImage = container.images[imageName]

    container.start({
      image: configuredImage ?? imageName,
      instance: options.instance ?? "lite",
      entrypoint: [...(options.entrypoint ?? ["sleep", "infinity"])],
      enableInternet: true,
    })
    await this.waitUntilReady(options)
  }

  private async waitUntilReady(options: WorkspaceContainerOptions): Promise<void> {
    if (!options.readyCommand) return

    const ready = await this.run(["sh", "-lc", options.readyCommand])

    if (ready.exitCode !== 0) {
      throw new Error(ready.stderr || ready.stdout || "Container readiness check failed")
    }
  }

  private async materialize(
    stepId: string,
    revision?: ContainerSnapshotValue,
    options: WorkspaceContainerOptions = {},
  ): Promise<void> {
    if (this.activeStepId === stepId) {
      await this.ensureRunning(options)
      return
    }

    if (!revision) {
      await this.ensureRunning(options)
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
        instance: options.instance ?? "lite",
        entrypoint: [...(options.entrypoint ?? ["sleep", "infinity"])],
        enableInternet: true,
      })
      await this.waitUntilReady(options)
      this.workingCheckpointId = revision.id
      this.dirty = false
    }

    this.activeStepId = stepId
  }

  /** Host-owned network policy, reapplied before commands after starts/restores. */
  protected async configureOutbound(): Promise<void> {}

  private async run(
    command: ReadonlyArray<string>,
    cwd?: string,
  ): Promise<ContainerExecutionResult> {
    await this.configureOutbound()
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

  /** Materialize a host-read source export into a fresh, fixed workspace (Python image required). */
  async materializeSource(files: ReadonlyArray<SourceFile>, options: WorkspaceContainerOptions = {}): Promise<void> {
    const manifest = JSON.stringify(files)
    if (files.length > 1000 || new TextEncoder().encode(manifest).length > 96 * 1024) throw new Error("Source manifest limit exceeded")
    await this.ensureRunning(options)
    const result = await this.run(["python3", "-c", [
      "import base64,json,pathlib,shutil,sys",
      "files=json.loads(sys.argv[1]); root=pathlib.Path('/workspace/repository')",
      "for f in files:",
      " p=pathlib.PurePosixPath(f['path'])",
      " if p.is_absolute() or not p.parts or any(s in ('','.','..') for s in f['path'].split('/')) or '\\\\' in f['path'] or '\\x00' in f['path']: raise ValueError('Invalid source path')",
      "if root.exists(): shutil.rmtree(root)",
      "root.mkdir(parents=True)",
      "for f in files:",
      " p=root/f['path']; p.parent.mkdir(parents=True,exist_ok=True)",
      " p.write_bytes(base64.b64decode(f['base64'],validate=True)); p.chmod(0o755 if f['executable'] else 0o644)",
    ].join("\n"), manifest])
    if (result.exitCode !== 0) throw new Error("Source materialization failed")
    this.dirty = true
  }

  async checkout(
    repository: string,
    revision: string,
    targetDirectory = defaultTargetDirectory,
    options: WorkspaceContainerOptions = {},
    token?: string,
    cachePaths: ReadonlyArray<string> = [],
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

    // A cache snapshot is transport, not the next run's source workspace. Keep
    // only the declared cache directories; stale outputs and dependencies go away.
    const clean = await this.run(cleanCheckoutCommand(targetDirectory, cachePaths))
    if (clean.exitCode !== 0) {
      throw new Error(clean.stderr || clean.stdout || "git clean failed")
    }
  }

  async execute(
    command: string,
    cwd: string,
    stepId: string,
    revision?: ContainerSnapshotValue,
    cachePaths: ReadonlyArray<string> = [],
    cacheRoot = cwd,
    options: WorkspaceContainerOptions = {},
  ): Promise<ContainerExecutionResult> {
    await this.materialize(stepId, revision, options)
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
    options: WorkspaceContainerOptions = {},
  ): Promise<string | undefined> {
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`Workspace path must be relative: ${path}`)
    }

    await this.materialize(stepId, revision, options)

    const exists = await this.run(["test", "-e", path], cwd)

    if (exists.exitCode !== 0) return undefined

    const response = await this.run(["cat", "--", path], cwd)

    if (response.exitCode !== 0) {
      throw new Error(response.stderr || response.stdout || `Could not read ${path}`)
    }

    return response.stdout
  }

  async exists(
    path: string,
    cwd: string,
    stepId: string,
    revision?: ContainerSnapshotValue,
    options: WorkspaceContainerOptions = {},
  ): Promise<boolean> {
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`Workspace path must be relative: ${path}`)
    }

    await this.materialize(stepId, revision, options)

    const result = await this.run(["test", "-e", path], cwd)

    return result.exitCode === 0
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

  async restore(
    snapshot: ContainerSnapshotValue,
    options: WorkspaceContainerOptions = {},
  ): Promise<void> {
    const container = this.container()

    await this.ctx.storage.put("activeCheckpoint", snapshot)

    if (container.running) {
      await container.destroy(`Restoring workspace checkpoint ${snapshot.id}`)
    }

    container.start({
      containerSnapshot: snapshot,
      instance: options.instance ?? "lite",
      entrypoint: [...(options.entrypoint ?? ["sleep", "infinity"])],
      enableInternet: true,
    })
    await this.waitUntilReady(options)
    this.activeStepId = undefined
    this.dirty = false
    this.workingCheckpointId = snapshot.id
  }
}

export interface RunnerOptions {
  readonly binding: DurableObjectNamespace
  readonly cache?: {
    readonly key: string
    readonly keyFiles: ReadonlyArray<string>
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
  readonly actionExecutor: CI.ActionExecutor
  readonly executor: CI.CommandExecutor
  readonly fileSystem: CI.WorkspaceFileSystem
  readonly persistence: CI.WorkspacePersistence
  readonly source: CI.SourceService
}

export interface WorkflowParameters {
  readonly repository: string
  readonly revision: string
  /** Normalized triggering event; source identity always comes from repository/revision. */
  readonly event?: Pick<CI.WorkflowEventShape, "type" | "ref" | "payload">
}

export interface WorkflowEnvironment {
  /**
   * An explicit cross-Worker binding. Same-Worker entrypoints use
   * `ctx.exports.WorkspaceContainer` instead.
   */
  readonly Workspace?: DurableObjectNamespace
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
  const activeBodies = new Set<string>()
  const bodyOperation = <A>(stepId: string, name: string, operation: () => Promise<A>): Promise<A> =>
    activeBodies.has(stepId) ? operation() : options.step.do(name, operation as () => Promise<any>) as Promise<A>
  const executeCommand = makeCommandStepExecutor(options.step)
  const primary = options.binding.getByName(options.workspaceId) as unknown as WorkspaceContainerStub
  const containerFor = (
    stepId: string,
    workspace?: CI.Workspace,
  ): WorkspaceContainerStub => workspace?.revision
    ? options.binding.getByName(
        `${options.workspaceId}:step=${stepId}`,
      ) as unknown as WorkspaceContainerStub
    : primary
  let cache: WorkspaceContainerStub | undefined
  const targetDirectory = options.targetDirectory ?? defaultTargetDirectory

  return {
    actionExecutor: makeActionExecutor(options.step, activeBodies),
    source: {
      checkout: () => Effect.tryPromise({
        try: async () => {
          if (options.cache) {
            // Read inputs from this run's source, never from a previous cache snapshot.
            await options.step.do("workspace-cache:source", async () => {
              const token = typeof options.token === "function" ? await options.token() : options.token
              await primary.checkout(options.repository, options.revision, targetDirectory, options.container, token)
            })
            const identity = await options.step.do("workspace-cache:identity", async () => {
              const files: Array<readonly [string, string | undefined]> = []
              for (const path of options.cache!.keyFiles) {
                // Validate before handing any path to the filesystem RPC.
                await cacheIdentity({ repository: options.repository, key: "validate", paths: [], container: null, files: [[path, undefined]] })
                files.push([path, await primary.readFile(path, targetDirectory, "workspace-cache:source", undefined, options.container)])
              }
              return cacheIdentity({
                repository: options.repository,
                key: options.cache!.key,
                paths: options.cache!.paths ?? [],
                container: { image: defaultImage, ...options.container },
                files,
              })
            })
            cache = options.binding.getByName(identity) as unknown as WorkspaceContainerStub
          }
          if (cache) {
            const snapshot = await options.step.do("workspace-cache:restore", () =>
              cache!.getCachedSnapshot("latest"))

            if (snapshot) {
              await options.step.do("workspace-cache:materialize", () =>
                primary.restore(snapshot, options.container))
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
              options.cache?.paths,
            )
          })

          const cwd = options.root
            ? `${targetDirectory}/${options.root}`
            : targetDirectory

          return CI.Workspace.remote(options.workspaceId, cwd)
        },
        catch: (error) => error,
      }),
      reference: {
        kind: "git",
        repository: options.repository,
        revision: options.revision,
      },
    },
    executor: {
      handlesStepOptions: true,
      execute: ({ command, commandIndex, onOutput, options: stepOptions, stepId, workspace }) => Effect.tryPromise({
        try: async () => {
          if (workspace.kind !== "remote" || workspace.id !== options.workspaceId) {
            throw new Error(`Workspace ${workspace.cwd} does not belong to this Container`)
          }

          const revision = workspace.revision
          if (revision && revision.provider !== "cloudflare-container") {
            throw new Error(`Cannot materialize ${revision.provider} with Cloudflare`)
          }

          const container = containerFor(stepId, workspace)
          const execute = () => container.execute(
            command, workspace.cwd, stepId,
            revision?.value as ContainerSnapshotValue | undefined,
            options.cache?.paths, targetDirectory, options.container,
          )
          const result = activeBodies.has(stepId) ? await execute() : await executeCommand(
            { command, ...(commandIndex === undefined ? {} : { commandIndex }), stepId, workspace, options: stepOptions },
            execute,
          )
          if (result.exitCode !== 0) throw new CI.CommandError(stepId, command, workspace.cwd, result.exitCode, result.stderr || result.stdout)

          if (result.stdout) onOutput("stdout", result.stdout)
          if (result.stderr) onOutput("stderr", result.stderr)

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

          return bodyOperation(stepId, `${stepId}:exists-${pathId}`, () =>
            container.exists(
              path,
              workspace.cwd,
              stepId,
              revision?.value as ContainerSnapshotValue | undefined,
              options.container,
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

          return bodyOperation(stepId, `${stepId}:read-${pathId}`, () =>
            container.readFile(
              path,
              workspace.cwd,
              stepId,
              revision?.value as ContainerSnapshotValue | undefined,
              options.container,
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
          const snapshot = await bodyOperation(stepId, `${stepId}:commit`, () =>
            container.checkpoint(
              `${stepId}-workspace`,
              options.reuseWorkspace === false,
            ))

          if (cache) {
            await bodyOperation(stepId, `${stepId}:cache`, () =>
              cache!.putCachedSnapshot("latest", snapshot))
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
          const snapshot = await bodyOperation(stepId, `${stepId}:checkpoint-${checkpointId}`, () =>
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
          await bodyOperation(stepId, `${stepId}:restore`, () =>
            container.restore(
              checkpoint.handle.value as ContainerSnapshotValue,
              options.container,
            ))

          return checkpoint.workspace
        },
        catch: (error) => error,
      }),
    },
  }
}

/** Static workflows or event-time discovery; factories must checkpoint external reads. */
export const workflowEntrypoint = <
  A,
  Environment extends WorkflowEnvironment = WorkflowEnvironment,
>(
  workflow: CI.Workflow<A> | ((parameters: WorkflowParameters, step: WorkflowStep) => Promise<CI.Workflow<A>>),
  options: WorkflowEntrypointOptions<Environment> = {},
) => class EffectCIWorkflow extends WorkflowEntrypoint<
  Environment,
  WorkflowParameters
> {
  override async run(
    event: Readonly<WorkflowEvent<WorkflowParameters>>,
    step: WorkflowStep,
  ) {
    const binding = this.env.Workspace ??
      (this.ctx.exports as unknown as {
        readonly WorkspaceContainer?: DurableObjectNamespace
      }).WorkspaceContainer

    if (!binding) {
      throw new Error("WorkspaceContainer is not exported or bound")
    }

    const cache = options.cache === false ? undefined : options.cache
    const runner = makeRunner({
      binding,
      ...(cache
        ? {
            cache: {
              key: cache.key,
              keyFiles: cache.keyFiles,
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

    const definition = typeof workflow === "function"
      ? await workflow(event.payload, step)
      : workflow
    const result = await CI.runPromise(definition, {
      ci: true,
      env: "cloudflare",
      event: {
        type: event.payload.event?.type ?? "workflow_dispatch",
        payload: event.payload.event?.payload ?? event.payload,
        ...(event.payload.event?.ref ? { ref: event.payload.event.ref } : {}),
        revision: event.payload.revision,
        source: {
          kind: "git",
          repository: event.payload.repository,
          revision: event.payload.revision,
        },
      },
      executor: runner.executor,
      actionExecutor: runner.actionExecutor,
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
