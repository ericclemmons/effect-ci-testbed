import * as CI from "@effect-ci-testbed/ci"
import { gitSourceChangesCommand, parseGitSourceChanges } from "@effect-ci-testbed/ci/source-changes"
import { outputManifestCommand, parseOutputManifest, type OutputManifest } from "./output-manifest.ts"
import type { RunnerWorkspaceResult } from "./runner-step-result.ts"
import {
  DurableObject,
  WorkerEntrypoint,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import * as Effect from "effect/Effect"
import { cleanCheckoutCommand } from "./source-checkout.ts"
import { containerShell } from "./container-shell.ts"
import { capturedCommand } from "./captured-command.ts"
import { makeHostAttemptHandler, type HostAttemptHandler } from "./host-attempt.ts"
export { makeHostAttemptHandler, type HostAttemptHandler, type HostAttemptContext } from "./host-attempt.ts"
import { makeCommandStepExecutor } from "./command-step.ts"
import { commandFailure } from "./command-error.ts"
import { cacheIdentity } from "./cache-identity.ts"
import { makeActionExecutor } from "./action-step.ts"
import type { SourceFile } from "./artifacts-source.ts"
import { withWobsLogging } from "./wobs-logger.ts"
import { authenticatedGitFailure, gitCheckoutHost, githubCheckoutRepository, gitCheckoutRequest } from "./git-checkout-proxy.ts"
export { wobsLoggerLayer, withWobsLogging } from "./wobs-logger.ts"
export { SourceRevisions, readDurableSource } from "./durable-source.ts"

const decoder = new TextDecoder()
const defaultImage = "cloudflare/debian-trixie"
const defaultTargetDirectory = "/workspace/repository"
const uncheckpointedContainerLost = "Workspace has uncheckpointed changes but its container stopped; inspect the failed action, never restore an ancestor or rerun its commands automatically"

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

const snapshotValue = (snapshot: ContainerSnapshotValue): ContainerSnapshotValue => ({
  id: snapshot.id,
  ...(snapshot.name ? { name: snapshot.name } : {}),
  size: snapshot.size,
})

interface WorkspaceCommit {
  readonly stepId: string
  readonly cwd: string
  readonly revision?: ContainerSnapshotValue
  readonly options?: WorkspaceContainerOptions
}

interface CommittedWorkspace {
  readonly snapshot: ContainerSnapshotValue
  readonly stepId: string
  readonly cwd: string
  readonly revisionId?: string
}

interface WorkspaceContainerStub {
  readonly inspectOutput: (snapshot: ContainerSnapshotValue, cwd: string, patterns: ReadonlyArray<string>, options?: WorkspaceContainerOptions) => Promise<OutputManifest>
  readonly sourceChanges: (comparison: CI.SourceComparison, cwd: string, options?: WorkspaceContainerOptions) => Promise<CI.SourceChanges>
  readonly getImageIdentity: (options?: WorkspaceContainerOptions) => Promise<string | undefined>
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
    commit?: WorkspaceCommit,
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
  /** Trusted hosts may avoid project-writable login startup files. Default
   * remains the existing login shell for other runners. */
  readonly loginShell?: boolean
}

interface WorkspaceContainerEnvironment {}

/** Host-only routing capability. No token or credentials are passed into the VM. */
export class GitCheckoutOutbound extends WorkerEntrypoint<unknown, { workspaceId: string; capability: string }> {
  override fetch(request: Request): Promise<Response> {
    const namespace = (this.ctx.exports as unknown as { WorkspaceContainer: DurableObjectNamespace<WorkspaceContainer> }).WorkspaceContainer
    return namespace.get(namespace.idFromString(this.ctx.props.workspaceId)).gitCheckoutFetch(request, this.ctx.props.capability)
  }
}

export class WorkspaceContainer extends DurableObject<WorkspaceContainerEnvironment> {
  private gitCheckout: { repository: string; token: string; capability: string; expiresAt: number; failure?: string } | undefined

  /** Called by the host outbound Worker, never exported as a public HTTP route. */
  async gitCheckoutFetch(request: Request, capability: string): Promise<Response> {
    const checkout = this.gitCheckout
    if (!checkout || checkout.capability !== capability || Date.now() >= checkout.expiresAt) return new Response("Git checkout inactive", { status: 403 })
    const response = await gitCheckoutRequest(request, checkout.repository, checkout.token)
    const failure = response.headers.get("x-effect-ci-git-failure")
    if (failure && /^(upstream-http-[1-5][0-9]{2}|unexpected-content-type|upstream-transport)$/.test(failure)) checkout.failure = failure
    return response
  }
  private activeStepId: string | undefined
  private dirty = false
  private workingCheckpointId: string | undefined

  // Memory alone cannot distinguish a clean ancestor from command output after
  // the provider object is evicted. No command text or credentials are stored.
  private async workingMutation(): Promise<{ stepId?: string; revisionId?: string } | undefined> {
    return await this.ctx.storage.get("workingMutation") ?? undefined
  }

  private async markMutation(stepId?: string, revisionId?: string): Promise<void> {
    await this.ctx.storage.put("workingMutation", { stepId, revisionId })
    this.dirty = true
  }

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

  /** Host-only platform metadata, never a digest supplied by project commands.
   * An unresolved mutable name cannot authorize a whole-container cache restore. */
  async getImageIdentity(options: WorkspaceContainerOptions = {}): Promise<string | undefined> {
    const image = options.image ?? defaultImage
    return this.container().images[image] ||
      (/^(?:.+@)?sha256:[a-f0-9]{64}$/.test(image) ? image : undefined)
  }

  private async ensureRunning(options: WorkspaceContainerOptions = {}): Promise<void> {
    const container = this.container()

    if (container.running) {
      return
    }

    if (await this.workingMutation()) {
      throw new Error(uncheckpointedContainerLost)
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

    const ready = await this.run(containerShell(options.readyCommand, options), undefined, options)

    if (ready.exitCode !== 0) {
      throw new Error(ready.stderr || ready.stdout || "Container readiness check failed")
    }
  }

  private async materialize(
    stepId: string,
    revision?: ContainerSnapshotValue,
    options: WorkspaceContainerOptions = {},
  ): Promise<void> {
    const mutation = await this.workingMutation()
    if (mutation) {
      if (!this.container().running) {
        throw new Error(uncheckpointedContainerLost)
      }
      if ((mutation.stepId !== undefined && (mutation.stepId !== stepId || mutation.revisionId !== revision?.id)) ||
        (mutation.stepId === undefined && revision !== undefined)) {
        throw new Error("Workspace has uncheckpointed changes owned by another action or input revision")
      }
      this.activeStepId = stepId
      this.dirty = true
      this.workingCheckpointId = mutation.revisionId
      return
    }

    // One action may read several dependency workspaces with the same paths.
    // Its identity alone does not mean the requested input is materialized.
    // Dirty inputs were checked above and must never be replaced here.
    if (this.activeStepId === stepId && (revision === undefined || this.workingCheckpointId === revision.id)) {
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

  /** Host-owned per-process environment. Never part of workspace options,
   * snapshots, command text or Workflow checkpoint values. */
  protected async processEnvironment(
    _command: ReadonlyArray<string>, _cwd?: string,
  ): Promise<Record<string, string> | undefined> { return undefined }

  /** Host-owned process restrictions. Project commands cannot choose this policy. */
  protected processCommand(command: ReadonlyArray<string>, _cwd: string | undefined,
    _options: WorkspaceContainerOptions): ReadonlyArray<string> { return command }

  /** Host enrollment only: a trusted native command can retain its real result
   * independently of the exec transport. Untrusted projects stay on direct exec. */
  protected captureExecutionResult(_options: WorkspaceContainerOptions): boolean { return false }

  /** A host may record completed command identity/outcome, never raw output. */
  protected capturedExecutionResult(_result: { readonly exitCode: number; readonly recovered: boolean }): void {}

  private async run(
    command: ReadonlyArray<string>,
    cwd?: string,
    options: WorkspaceContainerOptions = {},
    businessCommand = false,
  ): Promise<ContainerExecutionResult> {
    await this.configureOutbound()
    const environment = await this.processEnvironment(command, cwd)
    const argv = [...this.processCommand(command, cwd, options)]
    const execOptions = cwd || environment ? { ...(cwd ? { cwd } : {}), ...(environment ? { env: environment } : {}) } : undefined
    if (businessCommand && this.captureExecutionResult(options)) {
      const output = await capturedCommand({ argv,
        directory: `/tmp/effect-ci-command-${crypto.randomUUID()}`,
        running: () => this.container().running,
        exec: args => this.container().exec([...args], execOptions),
      })
      try { this.capturedExecutionResult({ exitCode: output.exitCode, recovered: output.recovered }) }
      catch { /* reporting cannot change or replay the completed command */ }
      return { exitCode: output.exitCode, stdout: decoder.decode(output.stdout), stderr: decoder.decode(output.stderr) }
    }
    const process = await this.container().exec(argv, execOptions)
    const output = await process.output()
    return { exitCode: output.exitCode, stderr: decoder.decode(output.stderr), stdout: decoder.decode(output.stdout) }
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
    await this.markMutation()
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
    await this.markMutation()

    const git = await this.run(containerShell("command -v git", options))

    if (git.exitCode !== 0) {
      const installGit = await this.run(containerShell(
        "apt-get update && apt-get install --yes --no-install-recommends ca-certificates git", options,
      ))

      if (installGit.exitCode !== 0) {
        throw new Error(installGit.stderr || installGit.stdout || "git installation failed")
      }
    }

    if (this.gitCheckout) throw new Error("Git checkout already active")
    let remote = repository
    if (token) {
      const path = githubCheckoutRepository(repository)
      const outbound = (this.ctx.exports as unknown as {
        GitCheckoutOutbound: (options: { props: { workspaceId: string; capability: string } }) => Fetcher
      }).GitCheckoutOutbound
      if (!outbound) throw new Error("Authenticated checkout requires the host GitCheckoutOutbound export")
      const capability = crypto.randomUUID()
      await this.container().interceptOutboundHttp(gitCheckoutHost, outbound({ props: { workspaceId: this.ctx.id.toString(), capability } }))
      this.gitCheckout = { repository, token, capability, expiresAt: Date.now() + 10 * 60_000 }
      remote = `http://${gitCheckoutHost}/${path}`
    }
    // Disable credential helpers, inherited headers, redirects and repository hooks.
    // These are non-secret switches: only the host proxy has authentication.
    const gitPolicy = ["-c", "credential.helper=", "-c", "http.extraHeader=", "-c", "http.followRedirects=false", "-c", "core.hooksPath=/dev/null"]
    try {
      const existing = await this.run(["test", "-d", `${targetDirectory}/.git`])

      if (existing.exitCode !== 0) {
        const clone = await this.run([
          "git",
          ...gitPolicy,
          "clone",
          "--no-checkout",
          remote,
          targetDirectory,
        ])

        if (clone.exitCode !== 0) {
          throw token ? new Error(this.gitCheckout?.failure ? `Authenticated git clone failed (${this.gitCheckout.failure})` : authenticatedGitFailure("clone", clone.stderr).message) : new Error(clone.stderr || clone.stdout || "git clone failed")
        }
      }

      // Persist the canonical, token-free source identity, not the ephemeral proxy.
      const origin = await this.run(["git", ...gitPolicy, "-C", targetDirectory, "remote", "set-url", "origin", repository])
      if (origin.exitCode !== 0) throw new Error("Git source identity update failed")
      const fetch = await this.run([
        "git",
        ...gitPolicy,
        "-C",
        targetDirectory,
        "fetch",
        "--depth=1",
        remote,
        revision,
      ])

      if (fetch.exitCode !== 0) {
        throw token ? new Error(this.gitCheckout?.failure ? `Authenticated git fetch failed (${this.gitCheckout.failure})` : authenticatedGitFailure("fetch", fetch.stderr).message) : new Error(fetch.stderr || fetch.stdout || "git fetch failed")
      }

      // Revoke before checking out project-controlled files or running any hooks.
      this.gitCheckout = undefined
      const checkout = await this.run([
        "git",
        ...gitPolicy,
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
    } finally {
      // Failure, timeout/restart, and cache re-checkout all fail closed. State is
      // deliberately memory-only: snapshots and durable storage contain no token.
      this.gitCheckout = undefined
    }
  }

  /** Only a fixed Git read is allowed here. Never mark command ownership or
   * checkpoint a query as business work; dirty/lost work remains guarded. */
  async sourceChanges(comparison: CI.SourceComparison, cwd: string, options: WorkspaceContainerOptions = {}): Promise<CI.SourceChanges> {
    const command = gitSourceChangesCommand(comparison)
    if (!command) return { status: "unknown", reason: "unavailable" }
    await this.materialize("$source-changes", undefined, options)
    return parseGitSourceChanges(await this.run(containerShell(command, { ...options, loginShell: false }), cwd))
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
    await this.markMutation(stepId, revision?.id)

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

    const result = await this.run(containerShell(command, options), cwd, options, true)

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
    commit?: WorkspaceCommit,
  ): Promise<ContainerSnapshotValue> {
    // An action's final commit is immutable. If its acknowledgement was lost,
    // return that exact saved snapshot, never capture its ancestor on retry.
    const committed = commit ? await this.ctx.storage.get<CommittedWorkspace>(`committed:${name}`) : undefined
    if (committed) {
      if (committed.stepId !== commit!.stepId || committed.cwd !== commit!.cwd || committed.revisionId !== commit!.revision?.id) {
        throw new Error("Immutable workspace commit belongs to another action or input revision")
      }
      if (await this.workingMutation()) throw new Error("An immutable workspace commit cannot replace new uncheckpointed changes")
      await this.ctx.storage.put({ activeCheckpoint: committed.snapshot, workingMutation: null })
      if (this.container().running && (release || this.workingCheckpointId !== committed.snapshot.id || this.dirty)) {
        await this.container().destroy(`Recovering committed workspace ${committed.snapshot.id}`)
      }
      this.activeStepId = undefined
      this.dirty = false
      this.workingCheckpointId = committed.snapshot.id
      return snapshotValue(committed.snapshot)
    }
    if (commit && !await this.exists(".", commit.cwd, commit.stepId, commit.revision, commit.options)) {
      throw new Error("Cannot commit a missing workspace")
    }
    if (!this.container().running && await this.workingMutation()) {
      throw new Error(uncheckpointedContainerLost)
    }
    const snapshot = await this.container().snapshotContainer({ name })

    await this.ctx.storage.put({
      activeCheckpoint: snapshot,
      [`checkpoint:${name}`]: snapshot,
      ...(commit ? { [`committed:${name}`]: { snapshot, stepId: commit.stepId, cwd: commit.cwd, revisionId: commit.revision?.id } } : {}),
      workingMutation: null,
    })
    this.activeStepId = undefined
    this.dirty = false
    this.workingCheckpointId = snapshot.id

    if (release) {
      await this.container().destroy(`Releasing committed workspace ${snapshot.id}`)
    }

    return snapshotValue(snapshot)
  }

  /** Used only on a dedicated inspection object, never a business workspace. */
  async inspectOutput(snapshot: ContainerSnapshotValue, cwd: string, patterns: ReadonlyArray<string>, options: WorkspaceContainerOptions = {}): Promise<OutputManifest> {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (await this.workingMutation()) throw Error("Output inspection cannot replace uncheckpointed work")
      try {
        await this.restore(snapshot, { ...(options.instance ? { instance: options.instance } : {}),
          entrypoint: ["sleep", "infinity"], loginShell: false, readyCommand: "/usr/bin/python3 -I -c pass" })
        const result = await this.run(outputManifestCommand(patterns), cwd)
        if (result.exitCode !== 0) throw Error("Snapshot output inspection failed")
        return parseOutputManifest(result.stdout, patterns)
      } finally {
        if (this.container().running) await this.container().destroy("Releasing output inspection workspace")
      }
    })
  }

  async restore(
    snapshot: ContainerSnapshotValue,
    options: WorkspaceContainerOptions = {},
  ): Promise<void> {
    const container = this.container()

    await this.ctx.storage.put({ activeCheckpoint: snapshot, workingMutation: null })

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
  /** Host-only credential lifetime; the callback encloses just clone/fetch.
   * Never journal its token or expose it to project commands. */
  readonly withCheckoutToken?: (checkout: (token: string | undefined) => Promise<void>) => Promise<void>
  readonly workspaceId: string
}

export interface Runner {
  readonly outputs: {
    /** Observe an immutable result; this never creates a new business snapshot. */
    readonly inspect: (workspace: CI.Workspace, patterns: ReadonlyArray<string>) => Effect.Effect<{ snapshot: RunnerWorkspaceResult; manifest: OutputManifest }, unknown>
    readonly read: (snapshot: RunnerWorkspaceResult, patterns: ReadonlyArray<string>) => Effect.Effect<OutputManifest, unknown>
  }
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
  readonly event?: Pick<CI.WorkflowEventShape, "type" | "ref" | "payload" | "comparison">
}

export interface WorkflowEnvironment {
  /**
   * An explicit cross-Worker binding. Same-Worker entrypoints use
   * `ctx.exports.WorkspaceContainer` instead.
   */
  readonly Workspace?: DurableObjectNamespace
}

export interface WorkflowEntrypointOptions<Environment extends WorkflowEnvironment = WorkflowEnvironment, Parameters extends WorkflowParameters = WorkflowParameters> {
  /** Record the actual CI attempt, including successful outputs on failure.
   * Host-only persistence is authoritative; this does not authorize result reuse. */
  readonly onAttempt?: HostAttemptHandler<Environment, Parameters>
  readonly cache?: CI.WorkspaceCachePolicy | false
  readonly container?: WorkspaceContainerOptions
  readonly reuseWorkspace?: boolean
  /** Project directory within the checked-out repository. */
  readonly root?: string
  readonly secrets?: (environment: Environment) => CI.SecretResolver
  readonly checkCache?: (environment: Environment, context: { readonly runner: Runner }) => CI.CheckCache
  readonly stepResultCache?: (environment: Environment, context: { readonly runner: Runner }) => CI.StepResultCache
  readonly workspaceChanges?: (environment: Environment, context: {
    readonly runner: Runner
    readonly exports: unknown
    readonly instanceId: string
    readonly parameters: Parameters
  }) => CI.WorkspaceChangeProvider
}

export const makeRunner = (options: RunnerOptions): Runner => {
  let sourceSequence = 0
  let outputSequence = 0
  const activeBodies = new Set<string>()
  const fileSequences = new Map<string, number>()
  const bodyOperation = <A>(stepId: string, name: string, operation: () => Promise<A>): Promise<A> =>
    activeBodies.has(stepId) ? operation() : options.step.do(name, operation as () => Promise<any>) as Promise<A>
  const fileOperation = <A>(stepId: string, kind: "read" | "exists", operation: () => Promise<A>): Promise<A> => {
    if (activeBodies.has(stepId)) return operation()
    const sequence = (fileSequences.get(stepId) ?? 0) + 1
    fileSequences.set(stepId, sequence)
    // A path is not an observation identity: inputs and mutable contents may
    // differ between calls. Tuple ordinals also avoid lossy path sanitization.
    return options.step.do(`file:${JSON.stringify([stepId, sequence, kind])}`, operation as () => Promise<any>) as Promise<A>
  }
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
  const checkout = (cachePaths?: ReadonlyArray<string>) => {
    const perform = (token: string | undefined) => primary.checkout(
      options.repository, options.revision, targetDirectory, options.container, token, cachePaths,
    )
    return options.withCheckoutToken ? options.withCheckoutToken(perform) : (async () => {
      const token = typeof options.token === "function" ? await options.token() : options.token
      await perform(token)
    })()
  }

  const runner: Runner = {
    outputs: {
      inspect: (workspace, patterns) => Effect.gen(function* () {
        if (workspace.kind !== "remote" || workspace.id !== options.workspaceId || workspace.revision?.provider !== "cloudflare-container")
          return yield* Effect.fail(Error("Output comparison requires this run's immutable Cloudflare workspace"))
        const snapshot: RunnerWorkspaceResult = { kind: "workspace", provider: "cloudflare-container", cwd: workspace.cwd,
          snapshot: workspace.revision.value as ContainerSnapshotValue }
        return { snapshot, manifest: yield* runner.outputs.read(snapshot, patterns) }
      }),
      read: (value, patterns) => Effect.tryPromise({
        try: async () => {
          if (value?.kind !== "workspace" || value.provider !== "cloudflare-container" ||
            !(value.cwd === targetDirectory || value.cwd.startsWith(targetDirectory + "/")) ||
            value.cwd.split("/").some(part => part === "." || part === "..") || /[\x00-\x1f]/.test(value.cwd) ||
            typeof value.snapshot?.id !== "string" || !value.snapshot.id || value.snapshot.id.length > 1024 ||
            !Number.isSafeInteger(value.snapshot.size) || value.snapshot.size < 0) throw Error("Invalid output snapshot")
          const reader = options.binding.getByName(`${options.workspaceId}:outputs=${++outputSequence}`) as unknown as WorkspaceContainerStub
          return reader.inspectOutput(value.snapshot, value.cwd, patterns, options.container)
        }, catch: error => error,
      }),
    },
    actionExecutor: makeActionExecutor(options.step, activeBodies),
    source: {
      changes: comparison => Effect.gen(function* () {
        if (!comparison) return { status: "unknown", reason: "no-baseline" } as const
        const workspace = yield* runner.source.checkout()
        return yield* Effect.tryPromise({
          try: () => options.step.do(`source-changes:${++sourceSequence}`, { timeout: "30 seconds", retries: { limit: 0, delay: "1 second", backoff: "constant" } }, () =>
            primary.sourceChanges({ ...comparison, head: comparison.head ?? options.revision }, workspace.cwd, options.container)),
          catch: error => error,
        })
      }),
      checkout: () => Effect.tryPromise({
        try: async () => {
          if (options.cache) {
            // Read inputs from this run's source, never from a previous cache snapshot.
            await options.step.do("workspace-cache:source", async () => {
              await checkout()
            })
            const identity = await options.step.do("workspace-cache:identity", async () => {
              const image = await primary.getImageIdentity(options.container)
              if (!image) return undefined
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
                container: { ...options.container, image },
                files,
              })
            })
            // Native replay may return an identity journaled by an older host.
            // Never reopen its alias-only namespace after this policy upgrade.
            if (identity?.startsWith("cache:v3:")) cache = options.binding.getByName(identity) as unknown as WorkspaceContainerStub
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
            await checkout(options.cache?.paths)
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
          const execute = async () => {
            try {
              return await container.execute(
                command, workspace.cwd, stepId,
                revision?.value as ContainerSnapshotValue | undefined,
                options.cache?.paths, targetDirectory, options.container,
              )
            } catch {
              // Redact the host cause before crossing any native checkpoint.
              throw new CI.CommandExecutionError(stepId, command, workspace.cwd)
            }
          }
          const result = activeBodies.has(stepId) ? await execute() : await executeCommand(
            { command, ...(commandIndex === undefined ? {} : { commandIndex }), stepId, workspace, options: stepOptions },
            execute,
          )
          if (result.exitCode !== 0) throw commandFailure({ stepId, command, workspace }, result)

          if (result.stdout) onOutput("stdout", result.stdout)
          if (result.stderr) onOutput("stderr", result.stderr)

          return result
        },
        catch: (error) => error instanceof CI.CommandError || error instanceof CI.CommandCheckpointError || error instanceof CI.CommandExecutionError
          ? error
          // RPC/setup/output failures do not establish a child process exit.
          // Do not copy arbitrary provider causes (which may contain secrets).
          : new CI.CommandExecutionError(stepId, command, workspace.cwd),
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

          const container = containerFor(stepId, workspace)

          return fileOperation(stepId, "exists", () =>
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

          const container = containerFor(stepId, workspace)

          return fileOperation(stepId, "read", () =>
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
          if (workspace.revision && workspace.revision.provider !== "cloudflare-container") {
            throw new Error(`Cannot materialize ${workspace.revision.provider} with Cloudflare`)
          }
          const snapshot = await bodyOperation(stepId, `${stepId}:commit`, async () => {
            // Returning a dependency workspace is enough: even a pass-through
            // action with no commands must commit that revision, not an empty container.
            // The same-step materializer preserves any writes this action already made.
            return container.checkpoint(
              `${stepId}-workspace`,
              options.reuseWorkspace === false,
              {
                stepId, cwd: workspace.cwd,
                ...(workspace.revision ? { revision: workspace.revision.value as ContainerSnapshotValue } : {}),
                ...(options.container ? { options: options.container } : {}),
              },
            )
          })

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

          if (workspace.revision && workspace.revision.provider !== "cloudflare-container") {
            throw new Error(`Cannot materialize ${workspace.revision.provider} with Cloudflare`)
          }
          const container = containerFor(stepId, workspace)
          const checkpointId = name.replaceAll(/[^a-zA-Z0-9_-]/g, "-")
          const snapshot = await bodyOperation(stepId, `${stepId}:checkpoint-${checkpointId}`, async () => {
            // A publishing action may not have executed a command/read yet.
            // Materialize its dependency revision before capturing this snapshot.
            const exists = await container.exists(".", workspace.cwd, stepId,
              workspace.revision?.value as ContainerSnapshotValue | undefined, options.container)
            if (!exists) throw new Error("Cannot checkpoint a missing workspace")
            return container.checkpoint(name)
          })

          return {
            provider: "cloudflare-container",
            value: snapshot,
          }
        },
        catch: (error) => error,
      }),
      restore: ({ checkpoint, stepId }) => Effect.tryPromise({
        try: async () => {
          if (checkpoint.workspace.kind !== "remote" || checkpoint.workspace.id !== options.workspaceId) {
            throw new Error("Checkpoint workspace does not belong to this run")
          }
          if (checkpoint.handle.provider !== "cloudflare-container") {
            throw new Error(`Cannot restore ${checkpoint.handle.provider} with Cloudflare`)
          }

          const container = containerFor(stepId, checkpoint.workspace)
          await bodyOperation(stepId, `${stepId}:restore`, () =>
            container.restore(
              checkpoint.handle.value as ContainerSnapshotValue,
              options.container,
            ))

          // Subsequent reads/commands must keep this restored snapshot, not
          // rematerialize the older revision carried by the publishing workspace.
          return checkpoint.workspace.withRevision(checkpoint.handle)
        },
        catch: (error) => error,
      }),
    },
  }
  return runner
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
    const result = await Effect.runPromise(withWobsLogging(CI.run(definition, {
      ci: true,
      env: "cloudflare",
      event: {
        type: event.payload.event?.type ?? "workflow_dispatch",
        payload: event.payload.event?.payload ?? event.payload,
        ...(event.payload.event?.ref ? { ref: event.payload.event.ref } : {}),
        ...(event.payload.event?.comparison ? { comparison: event.payload.event.comparison } : {}),
        revision: event.payload.revision,
        source: {
          kind: "git",
          repository: event.payload.repository,
          revision: event.payload.revision,
        },
      },
      executor: runner.executor,
      actionExecutor: runner.actionExecutor,
      ...(options.onAttempt ? { onAttempt: makeHostAttemptHandler(step, options.onAttempt, {
        environment: this.env, exports: this.ctx.exports,
        instanceId: event.instanceId, parameters: event.payload,
      }) } : {}),
      output: "silent",
      ...(options.secrets ? { secrets: options.secrets(this.env) } : {}),
      source: runner.source,
      ...(options.checkCache
        ? { checkCache: options.checkCache(this.env, { runner }) }
        : {}),
      ...(options.stepResultCache
        ? { stepResultCache: options.stepResultCache(this.env, { runner }) }
        : {}),
      ...(options.workspaceChanges ? { workspaceChanges: { changed: request => Effect.suspend(() =>
        options.workspaceChanges!(this.env, { runner, exports: this.ctx.exports,
          instanceId: event.instanceId, parameters: event.payload }).changed(request)) } } : {}),
      workspaceFileSystem: runner.fileSystem,
      workspacePersistence: runner.persistence,
    }), { workflow: definition.id, instance: event.instanceId }, this.env))

    return result.plan
  }
}
export { hostedCheckBytes, verifyHostedCheckEvidence, type HostedCheckIdentity } from "./check-evidence.ts"
export { readGitHubCheckNote, type GitHubCheckNote, type GitHubCheckNoteReader } from "./check-note.ts"
export { hostedCheckCache, type HostedCheckCacheOptions } from "./check-cache.ts"
