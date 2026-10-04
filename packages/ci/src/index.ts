import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeSync } from "node:fs"
import { join } from "node:path"
import * as Cache from "effect/Cache"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Redacted from "effect/Redacted"
import * as Schedule from "effect/Schedule"
import * as ServiceMap from "effect/ServiceMap"

export type WorkflowDuration =
  | number
  | `${number} ${"second" | "minute" | "hour" | "day" | "week"}${"s" | ""}`

export interface WorkflowStepConfig {
  readonly retries?: {
    readonly limit: number
    readonly delay: WorkflowDuration
    readonly backoff?: "constant" | "linear" | "exponential"
  }
  readonly timeout?: WorkflowDuration
}

export interface StepOptions extends WorkflowStepConfig {
  readonly cache?: boolean | "auto"
  /** Capabilities the action needs. Runners use this to select the cheapest safe tier. */
  readonly execution?: ExecutionRequirements
  /** Allow a trusted runner to reuse signed evidence for this side-effect-free action. */
  readonly verification?: { readonly scope: "commit" }
}

export type ExecutionCapability =
  | "filesystem"
  | "javascript"
  | "native-binary"
  | "network"
  | "process"
  | "wasm"

export interface ExecutionRequirements {
  readonly capabilities: ReadonlyArray<ExecutionCapability>
  readonly preference?: "container" | "isolate-first"
}

export type WorkflowBody<A> =
  | Effect.Effect<A, any, any>
  | (() =>
      | A
      | Generator<any, A, any>
      | Effect.Effect<A, any, any>
      | Promise<A>)

type StepBody<A> = WorkflowBody<A>

export type ActionHandler<Args extends ReadonlyArray<unknown>, A> = (...args: Args) =>
  | Generator<any, A, any>
  | Effect.Effect<A, any, any>
  | Promise<A>

export type ActionConstruction<Args extends ReadonlyArray<unknown>, A> =
  WorkflowBody<ActionHandler<Args, A>>

interface StepDefinition<A = unknown> {
  readonly id: string
  readonly body: Effect.Effect<A, unknown, Runtime | CurrentStep>
  readonly options: StepOptions
}

export interface PlannedCommand {
  readonly command: string
  readonly cwd: string
}

export interface PlannedSourceTransform {
  readonly files: ReadonlyArray<string>
  readonly tool: string
}

export interface PlanNode {
  readonly id: string
  readonly after: ReadonlyArray<string>
  readonly needs: ReadonlyArray<string>
  readonly commands: ReadonlyArray<PlannedCommand>
  readonly sourceTransforms?: ReadonlyArray<PlannedSourceTransform>
  readonly condition?: Condition
  /** This node runs only after the referenced node exhausts its retry policy. */
  readonly compensationFor?: string
  readonly approval?: ApprovalRequest
  readonly artifacts: ReadonlyArray<{
    readonly direction: "publish" | "restore"
    readonly name: string
    readonly paths: ReadonlyArray<string>
  }>
  readonly optional: boolean
  readonly options: StepOptions
  /** Secret names required by the step. Values are never part of the plan. */
  readonly secrets: ReadonlyArray<string>
  readonly status:
    | "planned"
    | "queued"
    | "running"
    | "complete"
    | "reused"
    | "verified"
    | "warning"
    | "failed"
    | "skipped"
}

export interface WorkflowPlan {
  readonly workflowId: string
  readonly environment: string
  readonly mode: "plan" | "execute"
  readonly nodes: ReadonlyArray<PlanNode>
}

export interface WorkflowRerunPlan {
  readonly requested: ReadonlyArray<string>
  readonly rerun: ReadonlyArray<string>
  readonly reuse: ReadonlyArray<string>
}

export interface WorkflowAttempt {
  readonly id: string
  readonly number: number
  readonly workflowId: string
  readonly previousAttemptId?: string
  readonly requested: ReadonlyArray<string>
  readonly plan: WorkflowPlan
  readonly outputs: Readonly<Record<string, unknown>>
  readonly conclusion: "success" | "failure"
  readonly startedAt: string
  readonly completedAt: string
}

export interface WorkflowRerun {
  readonly previous: WorkflowAttempt
  readonly steps: ReadonlyArray<string>
}

export class WorkflowPlanError extends Error {
  readonly _tag = "WorkflowPlanError"

  constructor(message: string) {
    super(message)
  }
}

/**
 * Selects the requested nodes and every node that transitively needs them.
 * Ordering-only `after` edges do not carry values and therefore do not
 * invalidate downstream work.
 */
export const planRerun = (
  plan: WorkflowPlan,
  requested: ReadonlyArray<string>,
): WorkflowRerunPlan => {
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]))
  const requestedIds = new Set(requested)
  const uniqueRequested = [...requestedIds]

  for (const id of uniqueRequested) {
    if (!nodes.has(id)) {
      throw new WorkflowPlanError(`Unknown workflow node: ${id}`)
    }
  }

  const dependents = new Map<string, Set<string>>()
  for (const node of plan.nodes) {
    for (const dependency of node.needs) {
      const children = dependents.get(dependency) ?? new Set<string>()
      children.add(node.id)
      dependents.set(dependency, children)
    }
  }

  const affected = new Set(uniqueRequested)
  const pending = [...uniqueRequested]
  for (let index = 0; index < pending.length; index += 1) {
    const id = pending[index]!
    for (const dependent of dependents.get(id) ?? []) {
      if (affected.has(dependent)) continue
      affected.add(dependent)
      pending.push(dependent)
    }
  }

  return {
    requested: plan.nodes.filter((node) => requestedIds.has(node.id)).map((node) => node.id),
    rerun: plan.nodes.filter((node) => affected.has(node.id)).map((node) => node.id),
    reuse: plan.nodes.filter((node) => !affected.has(node.id)).map((node) => node.id),
  }
}

export type RuntimeEvent =
  | {
      readonly type: "approval.requested"
      readonly workflowId: string
      readonly stepId: string
      readonly requestId: string
      readonly approval: ApprovalRequest
      readonly timestamp: string
    }
  | {
      readonly type: "approval.resolved"
      readonly workflowId: string
      readonly stepId: string
      readonly requestId: string
      readonly decision: ApprovalDecision
      readonly actor?: string
      readonly timestamp: string
    }
  | {
      readonly type: "workflow.started"
      readonly workflowId: string
      readonly environment: string
      readonly mode: WorkflowPlan["mode"]
      readonly timestamp: string
    }
  | {
      readonly type: "dependency.added"
      readonly workflowId: string
      readonly stepId: string
      readonly needs: string
      readonly timestamp: string
    }
  | {
      readonly type: "step.status"
      readonly workflowId: string
      readonly stepId: string
      readonly status: PlanNode["status"]
      readonly optional: boolean
      readonly timestamp: string
    }
  | {
      readonly type: "step.output"
      readonly workflowId: string
      readonly stepId: string
      readonly stream: "stdout" | "stderr"
      readonly text: string
      readonly timestamp: string
    }
  | {
      readonly type: "workflow.plan"
      readonly workflowId: string
      readonly plan: WorkflowPlan
      readonly timestamp: string
    }
  | {
      readonly type: "workflow.completed"
      readonly workflowId: string
      readonly conclusion: "success" | "failure"
      readonly timestamp: string
    }

interface RuntimeNode {
  readonly id: string
  readonly artifacts: Array<{
    readonly direction: "publish" | "restore"
    readonly name: string
    readonly paths: ReadonlyArray<string>
  }>
  readonly commands: Array<PlannedCommand>
  readonly sourceTransforms: Array<PlannedSourceTransform>
  approval?: ApprovalRequest
  condition?: Condition
  compensationFor?: string
  readonly secrets: Set<string>
  executedCommands: number
  verifiedCommands: number
  status: PlanNode["status"]
}

interface RuntimeShape {
  readonly ci: boolean
  readonly workflowId: string
  readonly mode: WorkflowPlan["mode"]
  readonly nodes: Map<string, RuntimeNode>
  readonly afterEdges: Set<string>
  readonly edges: Set<string>
  readonly optionalSteps: Set<string>
  readonly outputs: Map<string, unknown>
  readonly cache: Cache.Cache<string, unknown, unknown, Runtime>
  readonly addDependency: (parent: string, child: string) => Effect.Effect<void>
  readonly addParallel: (
    parent: string,
    steps: ReadonlyArray<{ readonly id: string; readonly optional: boolean }>,
  ) => Effect.Effect<void>
  readonly markOptional: (stepId: string) => Effect.Effect<void>
  readonly skip: (stepId: string, condition: Condition) => Effect.Effect<void>
  readonly registerCompensation: (
    primaryId: string,
    compensationId: string,
    compensation: Effect.Effect<unknown, unknown, any>,
  ) => Effect.Effect<void, unknown, any>
  readonly requireSecret: (stepId: string, name: string) => Effect.Effect<void>
  readonly recordArtifact: (
    stepId: string,
    artifact: {
      readonly direction: "publish" | "restore"
      readonly name: string
      readonly paths: ReadonlyArray<string>
    },
  ) => Effect.Effect<void>
  readonly recoverOptional: (stepId: string) => Effect.Effect<boolean>
  readonly execute: (
    stepId: string,
    workspace: Workspace,
    command: string,
  ) => Effect.Effect<Workspace, CommandError>
  readonly transformSources: (
    stepId: string,
    request: SourceTransformRequest,
  ) => Effect.Effect<SourceTransformResult, unknown>
  readonly readFile: (
    stepId: string,
    workspace: Workspace,
    path: string,
  ) => Effect.Effect<string | undefined, unknown>
  readonly exists: (
    stepId: string,
    workspace: Workspace,
    path: string,
  ) => Effect.Effect<boolean, unknown>
  readonly checkpoint: (
    stepId: string,
    workspace: Workspace,
    name: string,
  ) => Effect.Effect<WorkspaceCheckpoint, unknown>
  readonly restore: (
    stepId: string,
    checkpoint: WorkspaceCheckpoint,
  ) => Effect.Effect<Workspace, unknown>
  readonly requestApproval: (
    stepId: string,
    request: ApprovalRequest,
  ) => Effect.Effect<ApprovalResult, ApprovalError>
}

const eventFileDescriptor = Number(process.env.EFFECT_CI_EVENT_FD)

export type RuntimeEventHandler = (event: RuntimeEvent) => void | Promise<void>
export type WorkflowAttemptHandler = (attempt: WorkflowAttempt) => void | Promise<void>

const writeEvent = (event: RuntimeEvent): void => {
  if (!Number.isInteger(eventFileDescriptor)) return
  writeSync(eventFileDescriptor, `${JSON.stringify(event)}\n`)
}

const makeEventEmitter = (handler?: RuntimeEventHandler) =>
  (event: RuntimeEvent): Effect.Effect<void> => Effect.tryPromise({
    try: async () => {
      writeEvent(event)
      await handler?.(event)
    },
    catch: (error) => error,
  }).pipe(Effect.orDie)

const publishAttempt = (
  handler: WorkflowAttemptHandler | undefined,
  attempt: WorkflowAttempt,
): Effect.Effect<void> => Effect.tryPromise({
  try: async () => {
    await handler?.(attempt)
  },
  catch: (error) => error,
}).pipe(Effect.orDie)

class Runtime extends ServiceMap.Service<Runtime, RuntimeShape>()(
  "@effect-ci-testbed/Runtime",
) {}

class CurrentStep extends ServiceMap.Service<CurrentStep, string>()(
  "@effect-ci-testbed/CurrentStep",
) {}

/** Run a source-in/result-out tool without implying a shell or persistent filesystem. */
export const transformSources = (
  request: SourceTransformRequest,
): Effect.Effect<SourceTransformResult, unknown, Runtime | CurrentStep> =>
  Effect.gen(function* () {
    const runtime = yield* Runtime
    const stepId = yield* CurrentStep

    return yield* runtime.transformSources(stepId, request)
  })

export class CommandError extends Error {
  readonly _tag = "CommandError"
  readonly stepId: string
  readonly command: string
  readonly cwd: string
  readonly exitCode: number

  constructor(
    stepId: string,
    command: string,
    cwd: string,
    exitCode: number,
  ) {
    super(`Command failed (${exitCode}): ${command}`)
    this.stepId = stepId
    this.command = command
    this.cwd = cwd
    this.exitCode = exitCode
  }
}

export interface ApprovalRequest {
  readonly title: string
  readonly summary: string
  readonly approveLabel?: string
  readonly rejectLabel?: string
}

export type ApprovalDecision = "approved" | "rejected"

export interface ApprovalResult {
  readonly decision: ApprovalDecision
  readonly actor?: string
}

export interface ApprovalRuntimeRequest extends ApprovalRequest {
  readonly requestId: string
  readonly stepId: string
  readonly workflowId: string
}

export interface ApprovalHandler {
  readonly request: (
    request: ApprovalRuntimeRequest,
  ) => Effect.Effect<ApprovalResult, unknown>
}

export class ApprovalError extends Error {
  readonly _tag = "ApprovalError"
  readonly stepId: string
  readonly decision: "rejected" | "unavailable"

  constructor(
    stepId: string,
    decision: "rejected" | "unavailable",
    message: string,
  ) {
    super(message)
    this.stepId = stepId
    this.decision = decision
  }
}

export class SecretError extends Error {
  readonly _tag = "SecretError"
  readonly secret: string

  constructor(secret: string, message = `Missing required secret: ${secret}`) {
    super(message)
    this.secret = secret
  }
}

export interface SecretResolver {
  readonly resolve: (
    name: string,
  ) => Effect.Effect<Redacted.Redacted<string>, SecretError>
}

class SecretStore extends ServiceMap.Service<SecretStore, SecretResolver>()(
  "@effect-ci-testbed/SecretStore",
) {}

/**
 * Declares and resolves a secret without making its value plan-serializable.
 * Runners may back this with environment variables, Varlock, Cloudflare's
 * secret store, or an RPC capability that never enters the workload container.
 */
export const Secret = (
  name: string,
): Effect.Effect<Redacted.Redacted<string>, SecretError, Runtime | CurrentStep | SecretStore> => {
  if (!name.trim()) throw new Error("CI secret name cannot be empty")

  return Effect.gen(function* () {
    const runtime = yield* Runtime
    const stepId = yield* CurrentStep
    yield* runtime.requireSecret(stepId, name)

    if (runtime.mode === "plan") {
      return Redacted.make("", { label: name })
    }

    const store = yield* SecretStore
    return yield* store.resolve(name)
  })
}

export class CompensationError extends Error {
  readonly _tag = "CompensationError"
  readonly stepId: string
  readonly original: unknown
  readonly compensation: unknown

  constructor(
    stepId: string,
    original: unknown,
    compensation: unknown,
  ) {
    super(`Compensation for ${stepId} failed after the original action failed`, {
      cause: new AggregateError([original, compensation]),
    })
    this.stepId = stepId
    this.original = original
    this.compensation = compensation
  }
}

export interface ApprovalService {
  readonly request: (
    request: ApprovalRequest,
  ) => Effect.Effect<ApprovalResult, ApprovalError, Runtime | CurrentStep>
}

export class Approval extends ServiceMap.Service<Approval, ApprovalService>()(
  "@effect-ci-testbed/Approval",
) {}

export type WorkspaceKind = "local" | "remote"

export class Workspace {
  readonly cwd: string
  readonly kind: WorkspaceKind
  readonly id: string | undefined
  readonly revision: WorkspaceCheckpointHandle | undefined

  private constructor(
    cwd: string,
    kind: WorkspaceKind,
    id?: string,
    revision?: WorkspaceCheckpointHandle,
  ) {
    this.cwd = cwd
    this.kind = kind
    this.id = id
    this.revision = revision
  }

  static local(cwd: string): Workspace {
    return new Workspace(cwd, "local")
  }

  static remote(
    id: string,
    cwd: string,
    revision?: WorkspaceCheckpointHandle,
  ): Workspace {
    return new Workspace(cwd, "remote", id, revision)
  }

  withRevision(revision: WorkspaceCheckpointHandle): Workspace {
    return new Workspace(this.cwd, this.kind, this.id, revision)
  }

  exec(command: string): Effect.Effect<Workspace, CommandError, Runtime | CurrentStep> {
    const workspace = this
    return Effect.gen(function* () {
      const runtime = yield* Runtime
      const stepId = yield* CurrentStep
      return yield* runtime.execute(stepId, workspace, command)
    })
  }

  readFile(path: string): Effect.Effect<string | undefined, unknown, Runtime | CurrentStep> {
    if (path.startsWith("/") || path.split("/").includes("..")) {
      return Effect.fail(new Error(`Workspace path must be relative: ${path}`))
    }

    const workspace = this

    return Effect.gen(function* () {
      const runtime = yield* Runtime
      const stepId = yield* CurrentStep

      return yield* runtime.readFile(stepId, workspace, path)
    })
  }

  exists(path: string): Effect.Effect<boolean, unknown, Runtime | CurrentStep> {
    if (path.startsWith("/") || path.split("/").includes("..")) {
      return Effect.fail(new Error(`Workspace path must be relative: ${path}`))
    }

    const workspace = this

    return Effect.gen(function* () {
      const runtime = yield* Runtime
      const stepId = yield* CurrentStep

      return yield* runtime.exists(stepId, workspace, path)
    })
  }

  checkpoint(name: string): Effect.Effect<WorkspaceCheckpoint, unknown, Runtime | CurrentStep> {
    const workspace = this

    return Effect.gen(function* () {
      const runtime = yield* Runtime
      const stepId = yield* CurrentStep

      return yield* runtime.checkpoint(stepId, workspace, name)
    })
  }

}

export interface WorkspaceCheckpointHandle {
  readonly provider: string
  readonly value: unknown
}

export class WorkspaceCheckpoint {
  readonly name: string
  readonly workspace: Workspace
  readonly handle: WorkspaceCheckpointHandle

  constructor(
    name: string,
    workspace: Workspace,
    handle: WorkspaceCheckpointHandle,
  ) {
    this.name = name
    this.workspace = workspace
    this.handle = handle
  }

  restore(): Effect.Effect<Workspace, unknown, Runtime | CurrentStep> {
    const checkpoint = this

    return Effect.gen(function* () {
      const runtime = yield* Runtime
      const stepId = yield* CurrentStep

      return yield* runtime.restore(stepId, checkpoint)
    })
  }
}

/** A runner-owned, restorable filesystem result. */
export class WorkspaceArtifact {
  readonly name: string
  readonly paths: ReadonlyArray<string>
  readonly checkpoint: WorkspaceCheckpoint

  constructor(
    name: string,
    paths: ReadonlyArray<string>,
    checkpoint: WorkspaceCheckpoint,
  ) {
    this.name = name
    this.paths = paths
    this.checkpoint = checkpoint
  }
}

const validateArtifact = (
  name: string,
  paths: ReadonlyArray<string>,
): void => {
  if (!name.trim()) throw new Error("CI artifact name cannot be empty")
  if (paths.length === 0) throw new Error("CI artifact requires at least one path")

  for (const path of paths) {
    if (!path || path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`CI artifact path must be repository-relative: ${path}`)
    }
  }
}

export const Artifact = {
  publish: (
    workspace: Workspace,
    options: { readonly name: string; readonly paths: ReadonlyArray<string> },
  ): Effect.Effect<WorkspaceArtifact, unknown, Runtime | CurrentStep> => {
    validateArtifact(options.name, options.paths)

    return Effect.gen(function* () {
      const runtime = yield* Runtime
      const stepId = yield* CurrentStep
      yield* runtime.recordArtifact(stepId, {
        direction: "publish",
        name: options.name,
        paths: options.paths,
      })
      const checkpoint = yield* workspace.checkpoint(`artifact:${options.name}`)

      return new WorkspaceArtifact(options.name, [...options.paths], checkpoint)
    })
  },
  restore: (
    artifact: WorkspaceArtifact,
  ): Effect.Effect<Workspace, unknown, Runtime | CurrentStep> => Effect.gen(function* () {
    const runtime = yield* Runtime
    const stepId = yield* CurrentStep
    yield* runtime.recordArtifact(stepId, {
      direction: "restore",
      name: artifact.name,
      paths: artifact.paths,
    })

    return yield* artifact.checkpoint.restore()
  }),
} as const

export class PackageManagerError extends Error {
  readonly _tag = "PackageManagerError"
  readonly cwd: string

  constructor(cwd: string, message: string) {
    super(message)
    this.cwd = cwd
  }
}

export type JavaScriptPackageManagerName = "npm" | "pnpm" | "yarn" | "bun"

export interface AptPackageManager {
  readonly workspace: Workspace
  readonly install: (
    packages: ReadonlyArray<string>,
  ) => Effect.Effect<Workspace, CommandError | PackageManagerError, Runtime | CurrentStep>
}

export const Apt = (
  workspace: Workspace,
): Effect.Effect<AptPackageManager, PackageManagerError> =>
  Effect.gen(function* () {
    const packageName = /^[a-zA-Z0-9][a-zA-Z0-9+.-]*$/

    return {
      workspace,
      install: (packages) => {
        const invalid = packages.find((name) => !packageName.test(name))

        if (invalid) {
          return Effect.fail(new PackageManagerError(
            workspace.cwd,
            `Invalid apt package name: ${invalid}`,
          ))
        }

        const names = packages.join(" ")
        const install = `apt-get install --yes --no-install-recommends ${names}`

        return workspace.exec(
          `if [ "$(id -u)" -eq 0 ]; then apt-get update && DEBIAN_FRONTEND=noninteractive ${install}; else sudo apt-get update && sudo env DEBIAN_FRONTEND=noninteractive ${install}; fi`,
        )
      },
    }
  })

export interface JavaScriptInstallOptions {
  readonly frozenLockfile?: boolean
  readonly offline?: boolean
}

export interface JavaScriptPackageManager {
  readonly name: JavaScriptPackageManagerName
  readonly workspace: Workspace
  readonly install: (
    options?: JavaScriptInstallOptions,
  ) => Effect.Effect<Workspace, CommandError, Runtime | CurrentStep>
  readonly run: (script: string) => Effect.Effect<Workspace, CommandError, Runtime | CurrentStep>
  readonly exec: (command: string) => Effect.Effect<Workspace, CommandError, Runtime | CurrentStep>
}

const fromPackageManagerField = (
  contents: string | undefined,
): JavaScriptPackageManagerName | undefined => {
  if (!contents) return undefined
  const packageJson = JSON.parse(contents) as {
    readonly packageManager?: string
  }
  const name = packageJson.packageManager?.split("@")[0]
  return name === "npm" || name === "pnpm" || name === "yarn" || name === "bun"
    ? name
    : undefined
}

const lockfiles = [
  ["npm", "package-lock.json"],
  ["pnpm", "pnpm-lock.yaml"],
  ["yarn", "yarn.lock"],
  ["bun", "bun.lock"],
  ["bun", "bun.lockb"],
] as const

export const JavaScript = (
  workspace: Workspace,
): Effect.Effect<JavaScriptPackageManager, PackageManagerError, Runtime | CurrentStep> =>
  Effect.gen(function* () {
    const packageJson = yield* workspace.readFile("package.json")
    const lockfileMatches: Array<JavaScriptPackageManagerName> = []

    for (const [name, file] of lockfiles) {
      if (yield* workspace.exists(file)) {
        lockfileMatches.push(name)
      }
    }

    const names = [...new Set(lockfileMatches)]

    if (names.length > 1) {
      return yield* Effect.fail(new PackageManagerError(
        workspace.cwd,
        `Multiple JavaScript package-manager lockfiles found: ${names.join(", ")}`,
      ))
    }

    const name = yield* Effect.try({
      try: () => {
        const detected = fromPackageManagerField(packageJson) ?? names[0]

        if (!detected) {
          throw new PackageManagerError(
            workspace.cwd,
            "Could not detect a JavaScript package manager from packageManager or a lockfile",
          )
        }

        return detected
      },
      catch: (error) => error instanceof PackageManagerError
        ? error
        : new PackageManagerError(workspace.cwd, String(error)),
    })

    const command = (
      operation: "install" | "run" | "exec",
      value?: string,
      frozenLockfile = false,
      offline = false,
    ) => {
      switch (operation) {
        case "install": {
          const offlineFlag = offline ? " --offline" : ""

          if (!frozenLockfile) {
            switch (name) {
              case "npm":
                return `npm_config_cache=.effect-ci/cache/npm npm install${offlineFlag}`
              case "pnpm":
                return `pnpm install --store-dir .effect-ci/cache/pnpm${offlineFlag}`
              case "yarn":
                return `YARN_CACHE_FOLDER=.effect-ci/cache/yarn yarn install${offlineFlag}`
              case "bun":
                return `bun install --cache-dir .effect-ci/cache/bun${offlineFlag}`
            }
          }

          switch (name) {
            case "npm":
              return `npm_config_cache=.effect-ci/cache/npm npm ci${offlineFlag}`
            case "pnpm":
              return `pnpm install --frozen-lockfile --store-dir .effect-ci/cache/pnpm${offlineFlag}`
            case "yarn":
              return `YARN_CACHE_FOLDER=.effect-ci/cache/yarn yarn install --immutable${offlineFlag}`
            case "bun":
              return `bun install --frozen-lockfile --cache-dir .effect-ci/cache/bun${offlineFlag}`
          }
        }
        case "run":
          return `${name} run ${JSON.stringify(value)}`
        case "exec":
          return name === "bun"
            ? `bunx ${value}`
            : `${name} exec ${value}`
      }
    }

    return {
      name,
      workspace,
      install: (options?: JavaScriptInstallOptions) => Effect.gen(function* () {
        const runtime = yield* Runtime
        const frozenLockfile = options?.frozenLockfile ?? runtime.ci

        return yield* workspace.exec(command(
          "install",
          undefined,
          frozenLockfile,
          options?.offline ?? false,
        ))
      }),
      run: (script: string) => workspace.exec(command("run", script)),
      exec: (executable: string) => workspace.exec(command("exec", executable)),
    }
  }).pipe(
    Effect.mapError((error) => error instanceof PackageManagerError
      ? error
      : new PackageManagerError(workspace.cwd, String(error))),
  )

export const PackageManager = { Apt, JavaScript } as const

export class ToolchainError extends Error {
  readonly _tag = "ToolchainError"
  readonly cwd: string

  constructor(cwd: string, message: string) {
    super(message)
    this.cwd = cwd
  }
}

export interface NodeToolchain {
  readonly version: string
  readonly workspace: Workspace
  readonly install: () => Effect.Effect<Workspace, CommandError, Runtime | CurrentStep>
  readonly exec: (
    command: string,
  ) => Effect.Effect<Workspace, CommandError, Runtime | CurrentStep>
}

export interface MiseInstallOptions {
  readonly locked?: boolean
}

export interface MiseToolchain {
  readonly workspace: Workspace
  readonly install: (
    options?: MiseInstallOptions,
  ) => Effect.Effect<Workspace, CommandError, Runtime | CurrentStep>
  readonly exec: (
    command: string,
  ) => Effect.Effect<Workspace, CommandError, Runtime | CurrentStep>
}

const miseEnvironment = [
  "MISE_DATA_DIR=.effect-ci/cache/mise/data",
  "MISE_CACHE_DIR=.effect-ci/cache/mise/cache",
].join(" ")

const nodeVersion = (packageJson: string | undefined): string | undefined => {
  if (!packageJson) return undefined

  const value = JSON.parse(packageJson) as {
    readonly devEngines?: {
      readonly runtime?: ReadonlyArray<{
        readonly name?: string
        readonly version?: string
      }> | {
        readonly name?: string
        readonly version?: string
      }
    }
  }
  const runtime = Array.isArray(value.devEngines?.runtime)
    ? value.devEngines.runtime[0]
    : value.devEngines?.runtime

  return runtime?.name === "node" ? runtime.version : undefined
}

const Node = (
  workspace: Workspace,
): Effect.Effect<NodeToolchain, ToolchainError, Runtime | CurrentStep> =>
  Effect.gen(function* () {
    let version: string | undefined

    for (const path of [".node-version", ".nvmrc"]) {
      const contents = yield* workspace.readFile(path)

      if (contents) {
        version = contents.trim()
        break
      }
    }

    version ??= nodeVersion(yield* workspace.readFile("package.json"))

    if (!version) {
      return yield* Effect.fail(new ToolchainError(
        workspace.cwd,
        "Could not find a Node.js version in .node-version, .nvmrc, or package.json#devEngines.runtime",
      ))
    }

    if (!/^[a-zA-Z0-9][a-zA-Z0-9._+*/-]*$/.test(version)) {
      return yield* Effect.fail(new ToolchainError(
        workspace.cwd,
        `Invalid Node.js version request: ${version}`,
      ))
    }

    const tool = `node@${version}`

    return {
      version,
      workspace,
      install: () => workspace.exec(`${miseEnvironment} mise --yes install ${tool}`),
      exec: (command: string) => workspace.exec(
        `${miseEnvironment} mise exec ${tool} -- ${command}`,
      ),
    }
  }).pipe(
    Effect.mapError((error) => error instanceof ToolchainError
      ? error
      : new ToolchainError(workspace.cwd, String(error))),
  )

const Mise = (
  workspace: Workspace,
): Effect.Effect<MiseToolchain, ToolchainError, Runtime | CurrentStep> =>
  Effect.gen(function* () {
    const configurations = ["mise.toml", ".mise.toml", ".tool-versions"]
    let configured = false

    for (const path of configurations) {
      if (yield* workspace.exists(path)) {
        configured = true
        break
      }
    }

    if (!configured) {
      return yield* Effect.fail(new ToolchainError(
        workspace.cwd,
        `Could not find a Mise configuration (${configurations.join(", ")})`,
      ))
    }

    return {
      workspace,
      install: (options?: MiseInstallOptions) => workspace.exec(
        `${miseEnvironment} mise --yes${options?.locked ? " --locked" : ""} install`,
      ),
      exec: (command: string) => workspace.exec(
        `${miseEnvironment} mise exec -- ${command}`,
      ),
    }
  }).pipe(
    Effect.mapError((error) => error instanceof ToolchainError
      ? error
      : new ToolchainError(workspace.cwd, String(error))),
  )

export const Toolchain = { Node, Mise } as const

export interface SourceService {
  readonly checkout: (root: string) => Effect.Effect<Workspace, unknown>
}

export class Source extends ServiceMap.Service<Source, SourceService>()(
  "@effect-ci-testbed/Source",
) {}

const localSource: SourceService = {
  checkout: (root) => Effect.succeed(Workspace.local(root)),
}

export interface CommandExecutionRequest {
  readonly command: string
  readonly onOutput: (stream: "stdout" | "stderr", text: string) => void
  readonly options: StepOptions
  readonly stepId: string
  readonly workflowId: string
  readonly workspace: Workspace
}

export interface CommandExecutionResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

export interface CommandExecutor {
  /**
   * The executor maps retry and timeout options to its native runtime. When
   * omitted, Effect applies the policy around the complete action body.
   */
  readonly handlesStepOptions?: boolean
  readonly execute: (
    request: CommandExecutionRequest,
  ) => Effect.Effect<CommandExecutionResult, CommandError>
}

export interface SourceTransformRequest {
  readonly files: Readonly<Record<string, string>>
  readonly options?: Readonly<Record<string, unknown>>
  readonly tool: string
}

export interface SourceTransformResult {
  readonly changed: boolean
  readonly files: Readonly<Record<string, string>>
  readonly tier: "container" | "dynamic-worker" | "local" | "planned"
}

export interface SourceExecutionRequest extends SourceTransformRequest {
  readonly requirements: ExecutionRequirements
  readonly stepId: string
  readonly workflowId: string
}

export interface SourceExecutor {
  readonly execute: (
    request: SourceExecutionRequest,
  ) => Effect.Effect<SourceTransformResult, unknown>
}

export interface VerificationRequest {
  readonly command: string
  readonly event: WorkflowEventShape
  readonly policy: { readonly scope: "commit" }
  readonly stepId: string
  readonly workflowId: string
  readonly workspace: Workspace
}

/** The implementation verifies signatures and binds evidence to exact inputs. */
export interface VerificationStore {
  readonly lookup: (request: VerificationRequest) => Effect.Effect<boolean, unknown>
  readonly record: (request: VerificationRequest) => Effect.Effect<void, unknown>
}

export interface WorkspaceFileSystem {
  readonly exists: (
    workspace: Workspace,
    path: string,
    stepId: string,
  ) => Effect.Effect<boolean, unknown>
  readonly readFile: (
    workspace: Workspace,
    path: string,
    stepId: string,
  ) => Effect.Effect<string | undefined, unknown>
}

const localWorkspaceFileSystem: WorkspaceFileSystem = {
  exists: (workspace, path) => Effect.sync(() => existsSync(join(workspace.cwd, path))),
  readFile: (workspace, path) => Effect.try({
    try: () => {
      const target = join(workspace.cwd, path)

      return existsSync(target) ? readFileSync(target, "utf8") : undefined
    },
    catch: (error) => error,
  }),
}

export interface WorkspacePersistence {
  readonly commit: (request: {
    readonly stepId: string
    readonly workflowId: string
    readonly workspace: Workspace
  }) => Effect.Effect<Workspace, unknown>
  readonly checkpoint: (request: {
    readonly name: string
    readonly stepId: string
    readonly workflowId: string
    readonly workspace: Workspace
  }) => Effect.Effect<WorkspaceCheckpointHandle, unknown>
  readonly restore: (request: {
    readonly checkpoint: WorkspaceCheckpoint
    readonly stepId: string
    readonly workflowId: string
  }) => Effect.Effect<Workspace, unknown>
}

export interface Workflow<A> {
  readonly cache?: WorkflowCachePolicy | false
  readonly id: string
  readonly effect: Effect.Effect<A, unknown, Runtime | CurrentStep | WorkflowEvent | Approval>
}

/**
 * Portable cache intent. Paths and key files are repository-relative; the runner
 * decides how those paths are persisted.
 */
export interface WorkflowCachePolicy {
  readonly key: string
  readonly keyFiles: ReadonlyArray<string>
  readonly paths: ReadonlyArray<string>
}

export interface WorkflowOptions {
  readonly cache?: WorkflowCachePolicy | false
}

const validateCachePolicy = (
  cache: WorkflowCachePolicy | false | undefined,
): void => {
  if (cache === undefined || cache === false) return
  if (!cache.key.trim()) throw new Error("CI workflow cache key cannot be empty")
  if (cache.paths.length === 0) throw new Error("CI workflow cache requires at least one path")

  for (const path of [...cache.paths, ...cache.keyFiles]) {
    if (!path || path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`CI workflow cache path must be repository-relative: ${path}`)
    }
  }
}

export type WorkflowEventName =
  | "merge_group"
  | "pull_request"
  | "push"
  | "release"
  | "workflow_dispatch"

export interface WorkflowEventShape {
  readonly type: WorkflowEventName
  readonly payload?: unknown
  /** A normalized source ref such as `refs/heads/main` or `refs/tags/v1.0.0`. */
  readonly ref?: string
  /** The immutable source revision, normally a commit SHA. */
  readonly revision?: string
}

export class WorkflowEvent extends ServiceMap.Service<WorkflowEvent, WorkflowEventShape>()(
  "@effect-ci-testbed/WorkflowEvent",
) {}

/** A serializable predicate that can be rendered in a plan before it runs. */
export type Condition =
  | { readonly _tag: "event"; readonly oneOf: ReadonlyArray<WorkflowEventName> }
  | { readonly _tag: "ref"; readonly oneOf: ReadonlyArray<string> }
  | { readonly _tag: "all"; readonly conditions: ReadonlyArray<Condition> }
  | { readonly _tag: "any"; readonly conditions: ReadonlyArray<Condition> }
  | { readonly _tag: "not"; readonly condition: Condition }

export const Condition = {
  event: (...oneOf: ReadonlyArray<WorkflowEventName>): Condition => ({
    _tag: "event",
    oneOf,
  }),
  ref: (...oneOf: ReadonlyArray<string>): Condition => ({
    _tag: "ref",
    oneOf,
  }),
  all: (...conditions: ReadonlyArray<Condition>): Condition => ({
    _tag: "all",
    conditions,
  }),
  any: (...conditions: ReadonlyArray<Condition>): Condition => ({
    _tag: "any",
    conditions,
  }),
  not: (condition: Condition): Condition => ({ _tag: "not", condition }),
} as const

export const matchesCondition = (
  condition: Condition,
  event: WorkflowEventShape,
): boolean => {
  const payloadRef = event.payload && typeof event.payload === "object" &&
      "ref" in event.payload && typeof event.payload.ref === "string"
    ? event.payload.ref
    : undefined
  const ref = event.ref ?? payloadRef

  switch (condition._tag) {
    case "event":
      return condition.oneOf.includes(event.type)
    case "ref":
      return ref !== undefined && condition.oneOf.includes(ref)
    case "all":
      return condition.conditions.every((child) => matchesCondition(child, event))
    case "any":
      return condition.conditions.some((child) => matchesCondition(child, event))
    case "not":
      return !matchesCondition(condition.condition, event)
  }
}

const definitions = new Map<string, StepDefinition>()

const bodyToEffect = <A>(body: StepBody<A>): Effect.Effect<A, unknown, any> => {
  if (Effect.isEffect(body)) return body as Effect.Effect<A, unknown, any>

  return Effect.suspend(() => {
    const result = body()

    if (Effect.isEffect(result)) return result

    if (result && typeof result === "object" && "next" in result) {
      return Effect.gen(() => result as Generator<any, A, any>)
    }

    if (result && typeof result === "object" && "then" in result) {
      return Effect.tryPromise({
        try: () => result as Promise<A>,
        catch: (error) => error,
      })
    }

    return Effect.succeed(result as A)
  })
}

const validateStepOptions = (id: string, options: StepOptions): void => {
  if (options.retries) {
    if (!Number.isInteger(options.retries.limit) || options.retries.limit < 0) {
      throw new Error(`CI step ${id} retry limit must be a non-negative integer`)
    }
    if (typeof options.retries.delay === "number" && options.retries.delay < 0) {
      throw new Error(`CI step ${id} retry delay cannot be negative`)
    }
  }
  if (typeof options.timeout === "number" && options.timeout <= 0) {
    throw new Error(`CI step ${id} timeout must be greater than zero`)
  }
  if (options.execution?.capabilities.length === 0) {
    throw new Error(`CI step ${id} execution capabilities cannot be empty`)
  }
}

const runStep = <A>(
  id: string,
  needs: ReadonlyArray<string> = [],
): Effect.Effect<A, unknown, Runtime | CurrentStep> => {
  const effect = Effect.gen(function* () {
    const runtime = yield* Runtime
    const parent = yield* CurrentStep
    yield* runtime.addDependency(parent, id)
    for (const dependency of needs) {
      yield* runtime.addDependency(id, dependency)
    }
    return (yield* Cache.get(runtime.cache, id)) as A
  })
  actionIds.set(effect as object, id)
  return effect
}

const actionIds = new WeakMap<object, string>()
const optionalEffects = new WeakSet<object>()

export const optional = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A | undefined, E, R | Runtime> => {
  const stepId = actionIds.get(effect as object)
  if (!stepId) throw new Error("CI.optional expects a CI action or step")

  const optionalEffect = Effect.gen(function* () {
    const runtime = yield* Runtime
    yield* runtime.markOptional(stepId)
    return yield* effect.pipe(
      Effect.catch((error) => runtime.recoverOptional(stepId).pipe(
        Effect.flatMap((recovered) => recovered
          ? Effect.succeed(undefined)
          : Effect.fail(error)),
      )),
    )
  })
  actionIds.set(optionalEffect as object, stepId)
  optionalEffects.add(optionalEffect as object)
  return optionalEffect
}

/**
 * Conditionally executes an action while preserving the predicate in the plan.
 * Use ordinary Effect control flow for runtime-only decisions; use `when` when
 * operators and remote runners need to inspect the branch before execution.
 */
export const when = <A, E, R>(
  condition: Condition,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A | undefined, E, R | Runtime | CurrentStep | WorkflowEvent> => {
  const stepId = actionIds.get(effect as object)
  if (!stepId) throw new Error("CI.when expects a CI action or step")

  const conditional = Effect.gen(function* () {
    const runtime = yield* Runtime
    const parent = yield* CurrentStep

    if (runtime.mode === "plan") {
      const value = yield* effect
      const node = runtime.nodes.get(stepId)
      if (node) node.condition = condition
      return value
    }

    const event = yield* WorkflowEvent
    if (matchesCondition(condition, event)) return yield* effect

    yield* runtime.addDependency(parent, stepId)
    yield* runtime.skip(stepId, condition)
    return undefined
  })

  actionIds.set(conditional as object, stepId)
  return conditional
}

/**
 * Runs `compensation` only when `effect` has failed after exhausting its own
 * retry policy. The recovery edge is visible in plan mode.
 */
export const compensate = <A, E, R, B, E2, R2>(
  effect: Effect.Effect<A, E, R>,
  compensation: Effect.Effect<B, E2, R2>,
): Effect.Effect<A, E | CompensationError, R | R2 | Runtime> => {
  const primaryId = actionIds.get(effect as object)
  const compensationId = actionIds.get(compensation as object)
  if (!primaryId || !compensationId) {
    throw new Error("CI.compensate expects two CI actions or steps")
  }

  const compensated = Effect.gen(function* () {
    const runtime = yield* Runtime

    if (runtime.mode === "plan") {
      const value = yield* effect
      yield* runtime.registerCompensation(primaryId, compensationId, compensation)
      return value
    }

    yield* runtime.registerCompensation(primaryId, compensationId, compensation)

    return yield* effect.pipe(
      Effect.catch((original) => compensation.pipe(
        Effect.matchEffect({
          onFailure: (rollbackFailure) => Effect.fail(new CompensationError(
            primaryId,
            original,
            rollbackFailure,
          )),
          onSuccess: () => Effect.fail(original),
        }),
      )),
    )
  })

  actionIds.set(compensated as object, primaryId)
  return compensated as Effect.Effect<A, E | CompensationError, R | R2 | Runtime>
}

export const parallel = <Effects extends ReadonlyArray<Effect.Effect<any, any, any>>>(
  effects: Effects,
) => {
  const steps = effects.map((effect) => {
    const id = actionIds.get(effect as object)
    if (!id) throw new Error("CI.parallel expects CI actions or steps")
    return { id, optional: optionalEffects.has(effect as object) }
  })

  return Effect.gen(function* () {
    const runtime = yield* Runtime
    const parent = yield* CurrentStep
    yield* runtime.addParallel(parent, steps)
    return yield* Effect.validate(
      effects,
      (effect) => effect,
      { concurrency: "unbounded", discard: true },
    )
  })
}

export const step = <A>(
  id: string,
  body: StepBody<A>,
  options: StepOptions = {},
): Effect.Effect<A, unknown, Runtime | CurrentStep> => {
  validateStepOptions(id, options)
  if (definitions.has(id)) {
    throw new Error(`Duplicate CI step id: ${id}`)
  }

  definitions.set(id, { id, body: bodyToEffect(body), options })

  return runStep(id)
}

export const action = <
  A = Workspace,
  Args extends ReadonlyArray<unknown> = ReadonlyArray<never>,
>(
  id: string,
  construction: ActionConstruction<Args, NoInfer<A>>,
  options: StepOptions = {},
): ((...args: Args) => Effect.Effect<A, unknown, Runtime | CurrentStep>) => {
  let registered = false

  return (...args: Args) => {
    if (!registered) {
      validateStepOptions(id, options)
      if (definitions.has(id)) {
        throw new Error(`Duplicate CI action id: ${id}`)
      }
      registered = true
      definitions.set(id, {
        id,
        body: bodyToEffect(construction).pipe(
          Effect.flatMap((handler) => bodyToEffect(() => handler(...args))),
        ),
        options,
      })
    }

    return runStep(id)
  }
}

export const workflow = <A>(
  id: string,
  body: WorkflowBody<A>,
  options: WorkflowOptions = {},
): Workflow<A> => {
  validateCachePolicy(options.cache)

  return {
    id,
    effect: bodyToEffect(body),
    ...(options.cache === undefined ? {} : { cache: options.cache }),
  }
}

const makeLocalCommandExecutor = (): CommandExecutor => ({
  execute: ({ command, onOutput, stepId, workspace }) => Effect.callback<CommandExecutionResult, CommandError>((resume) => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const child = spawn(command, {
      cwd: workspace.cwd,
      env: process.env,
      shell: true,
      stdio: ["inherit", "pipe", "pipe"],
    })

    const forward = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString()
      if (stream === "stdout") {
        stdout.push(text)
      } else {
        stderr.push(text)
      }
      onOutput(stream, text)
    }

    child.stdout?.on("data", (chunk: Buffer) => forward("stdout", chunk))
    child.stderr?.on("data", (chunk: Buffer) => forward("stderr", chunk))

    child.once("error", () => resume(Effect.fail(new CommandError(stepId, command, workspace.cwd, 1))))
    child.once("close", (code) => {
      resume(code === 0
        ? Effect.succeed({ exitCode: 0, stderr: stderr.join(""), stdout: stdout.join("") })
        : Effect.fail(new CommandError(stepId, command, workspace.cwd, code ?? 1)))
    })

    return Effect.sync(() => child.kill("SIGTERM"))
  }),
})

const unavailableSourceExecutor: SourceExecutor = {
  execute: ({ tool }) => Effect.fail(new Error(
    `No source executor is configured for ${tool}`,
  )),
}

const withStepPolicy = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: WorkflowStepConfig,
): Effect.Effect<A, any, R> => {
  const timed = options.timeout === undefined
    ? effect
    : effect.pipe(Effect.timeout(options.timeout))
  const retries = options.retries

  if (!retries || retries.limit <= 0) return timed

  const schedule: Schedule.Schedule<any, any> = retries.backoff === "exponential"
    ? Schedule.exponential(retries.delay)
    : retries.backoff === "linear"
    ? Schedule.addDelay(
        Schedule.forever,
        (attempt) => Effect.succeed(Duration.times(
          Duration.fromInputUnsafe(retries.delay),
          attempt + 1,
        )),
      )
    : Schedule.spaced(retries.delay)

  return timed.pipe(Effect.retry({ times: retries.limit, schedule }))
}

const makeRuntime = (
  workflowId: string,
  ci: boolean,
  mode: WorkflowPlan["mode"],
  output: "inherit" | "silent",
  emitEvent: (event: RuntimeEvent) => Effect.Effect<void>,
  event: WorkflowEventShape,
  approvalHandler?: ApprovalHandler,
  commandExecutor: CommandExecutor = makeLocalCommandExecutor(),
  sourceExecutor: SourceExecutor = unavailableSourceExecutor,
  workspaceFileSystem: WorkspaceFileSystem = localWorkspaceFileSystem,
  workspacePersistence: WorkspacePersistence = {
    commit: ({ workspace }) => Effect.succeed(workspace),
    checkpoint: () => Effect.succeed({ provider: "local", value: undefined }),
    restore: ({ checkpoint }) => Effect.succeed(checkpoint.workspace),
  },
  verification?: VerificationStore,
  rerun?: {
    readonly previous: WorkflowAttempt
    readonly selection: WorkflowRerunPlan
  },
) =>
  Effect.gen(function* () {
    const nodes = new Map<string, RuntimeNode>()
    const afterEdges = new Set<string>()
    const edges = new Set<string>()
    const failureOrigins = new Map<unknown, string>()
    const optionalSteps = new Set<string>()
    const outputs = new Map<string, unknown>()
    const parallelSteps = new Set<string>()
    const reusable = new Set(rerun?.selection.reuse ?? [])
    const previousNodes = new Map(
      rerun?.previous.plan.nodes.map((node) => [node.id, node]) ?? [],
    )
    let workflowBarrier: {
      readonly after: ReadonlyArray<string>
      readonly needs: ReadonlyArray<string>
    } = { after: [], needs: [] }
    let runtime!: RuntimeShape

    for (const id of reusable) {
      const previousNode = previousNodes.get(id)
      if (!previousNode) {
        return yield* Effect.fail(new WorkflowPlanError(
          `Previous attempt has no plan node for reusable step: ${id}`,
        ))
      }
      if (!Object.hasOwn(rerun?.previous.outputs ?? {}, id)) {
        return yield* Effect.fail(new WorkflowPlanError(
          `Previous attempt has no output for reusable step: ${id}`,
        ))
      }

      for (const dependency of previousNode.needs) edges.add(`${id}->${dependency}`)
      for (const dependency of previousNode.after) afterEdges.add(`${id}->${dependency}`)
      if (previousNode.optional) optionalSteps.add(id)
      nodes.set(id, {
        id,
        artifacts: [...(previousNode.artifacts ?? [])],
        commands: [...previousNode.commands],
        sourceTransforms: [...(previousNode.sourceTransforms ?? [])],
        ...(previousNode.approval ? { approval: previousNode.approval } : {}),
        ...(previousNode.condition ? { condition: previousNode.condition } : {}),
        ...(previousNode.compensationFor
          ? { compensationFor: previousNode.compensationFor }
          : {}),
        secrets: new Set(previousNode.secrets ?? []),
        executedCommands: 0,
        verifiedCommands: 0,
        status: "reused",
      })
      outputs.set(id, rerun!.previous.outputs[id])
      yield* emitEvent({
        type: "step.status",
        workflowId,
        stepId: id,
        status: "reused",
        optional: previousNode.optional,
        timestamp: new Date().toISOString(),
      })
    }

    const cache = yield* Cache.make<string, unknown, unknown, Runtime, "lookup">({
      capacity: 1_000,
      timeToLive: Duration.infinity,
      requireServicesAt: "lookup",
      lookup: (id) => {
        const definition = definitions.get(id)
        if (!definition) return Effect.fail(new Error(`Unknown CI step: ${id}`))

        const node: RuntimeNode = nodes.get(id) ?? {
          id,
          artifacts: [],
          commands: [],
          sourceTransforms: [],
          secrets: new Set(),
          executedCommands: 0,
          verifiedCommands: 0,
          status: "planned" as const,
        }
        nodes.set(id, node)

        if (reusable.has(id)) {
          return Effect.succeed(outputs.get(id))
        }

        node.status = mode === "plan" ? "planned" : "queued"
        const queued = emitEvent({
          type: "step.status",
          workflowId,
          stepId: id,
          status: node.status,
          optional: optionalSteps.has(id),
          timestamp: new Date().toISOString(),
        })

        const body = commandExecutor.handlesStepOptions
          ? definition.body
          : withStepPolicy(definition.body, definition.options)

        return queued.pipe(
          Effect.andThen(body),
          Effect.provideService(CurrentStep, id),
          Effect.flatMap((value) =>
            mode === "execute" && value instanceof Workspace
              ? workspacePersistence.commit({
                  stepId: id,
                  workflowId,
                  workspace: value,
                })
              : Effect.succeed(value)),
          Effect.tap((value) => Effect.sync(() => {
            outputs.set(id, value)
          })),
          Effect.tap(() => {
            node.status = mode === "plan"
              ? "planned"
              : node.verifiedCommands > 0 && node.executedCommands === 0
              ? "verified"
              : "complete"

            return emitEvent({
              type: "step.status",
              workflowId,
              stepId: id,
              status: node.status,
              optional: optionalSteps.has(id),
              timestamp: new Date().toISOString(),
            })
          }),
          Effect.tapError((error) => {
            const origin = failureOrigins.get(error)
            node.status = origin && origin !== id ? "skipped" : "failed"
            if (!origin) failureOrigins.set(error, id)

            return emitEvent({
              type: "step.status",
              workflowId,
              stepId: id,
              status: node.status,
              optional: optionalSteps.has(id),
              timestamp: new Date().toISOString(),
            })
          }),
        )
      },
    })

    runtime = {
      ci,
      workflowId,
      mode,
      nodes,
      afterEdges,
      edges,
      optionalSteps,
      outputs,
      cache,
      addDependency: (parent, child) => Effect.gen(function* () {
        if (parent === "$workflow") {
          if (parallelSteps.delete(child)) return
          for (const dependency of workflowBarrier.needs) {
            edges.add(`${child}->${dependency}`)
          }
          for (const dependency of workflowBarrier.after) {
            afterEdges.add(`${child}->${dependency}`)
          }
          workflowBarrier = optionalSteps.has(child)
            ? { after: [child], needs: [] }
            : { after: [], needs: [child] }
          return
        }
        edges.add(`${parent}->${child}`)
        yield* emitEvent({
          type: "dependency.added",
          workflowId,
          stepId: parent,
          needs: child,
          timestamp: new Date().toISOString(),
        })
      }),
      addParallel: (parent, steps) => Effect.sync(() => {
        if (parent !== "$workflow") return
        for (const step of steps) {
          if (step.optional) optionalSteps.add(step.id)
          parallelSteps.add(step.id)
          for (const dependency of workflowBarrier.needs) {
            edges.add(`${step.id}->${dependency}`)
          }
          for (const dependency of workflowBarrier.after) {
            afterEdges.add(`${step.id}->${dependency}`)
          }
        }
        workflowBarrier = {
          after: steps.filter((step) => step.optional).map((step) => step.id),
          needs: steps.filter((step) => !step.optional).map((step) => step.id),
        }
      }),
      markOptional: (stepId) => Effect.sync(() => {
        optionalSteps.add(stepId)
      }),
      skip: (stepId, condition) => Effect.gen(function* () {
        const definition = definitions.get(stepId)
        if (!definition) {
          return yield* Effect.die(new Error(`Unknown CI step: ${stepId}`))
        }
        const node = nodes.get(stepId) ?? {
          id: stepId,
          artifacts: [],
          commands: [],
          sourceTransforms: [],
          secrets: new Set(),
          executedCommands: 0,
          verifiedCommands: 0,
          status: "skipped" as const,
        }
        node.condition = condition
        node.status = "skipped"
        nodes.set(stepId, node)
        yield* emitEvent({
          type: "step.status",
          workflowId,
          stepId,
          status: "skipped",
          optional: optionalSteps.has(stepId),
          timestamp: new Date().toISOString(),
        })
      }),
      registerCompensation: (primaryId, compensationId, compensation) => Effect.gen(function* () {
        const node = nodes.get(compensationId) ?? {
          id: compensationId,
          artifacts: [],
          commands: [],
          sourceTransforms: [],
          secrets: new Set(),
          executedCommands: 0,
          verifiedCommands: 0,
          status: mode === "plan" ? "planned" as const : "skipped" as const,
        }
        node.compensationFor = primaryId
        nodes.set(compensationId, node)

        if (mode !== "plan") return

        const barrier = workflowBarrier
        workflowBarrier = { after: [], needs: [] }
        yield* compensation.pipe(
          Effect.asVoid,
          Effect.ensuring(Effect.sync(() => {
            workflowBarrier = barrier
          })),
        )
        const planned = nodes.get(compensationId)
        if (planned) planned.compensationFor = primaryId
      }),
      requireSecret: (stepId, name) => Effect.sync(() => {
        const node = nodes.get(stepId)
        if (!node) throw new Error(`Missing plan node for ${stepId}`)
        node.secrets.add(name)
      }),
      recordArtifact: (stepId, artifact) => Effect.sync(() => {
        const node = nodes.get(stepId)
        if (!node) throw new Error(`Missing plan node for ${stepId}`)
        node.artifacts.push(artifact)
      }),
      recoverOptional: (stepId) => Effect.gen(function* () {
        const node = nodes.get(stepId)
        if (!node || node.status !== "failed") return false
        node.status = "warning"
        yield* emitEvent({
          type: "step.status",
          workflowId,
          stepId,
          status: node.status,
          optional: true,
          timestamp: new Date().toISOString(),
        })
        return true
      }),
      execute: (stepId, workspace, command) => {
        const node = nodes.get(stepId)
        if (!node) return Effect.die(new Error(`Missing plan node for ${stepId}`))

        node.commands.push({ command, cwd: workspace.cwd })

        if (mode === "plan") {
          return Effect.succeed(workspace)
        }

        const started = node.status !== "running"
          ? (() => {
            node.status = "running"

            return emitEvent({
              type: "step.status",
              workflowId,
              stepId,
              status: "running",
              optional: optionalSteps.has(stepId),
              timestamp: new Date().toISOString(),
            })
          })()
          : Effect.void

        const policy = definitions.get(stepId)?.options.verification
        const verificationRequest = policy
          ? { command, event, policy, stepId, workflowId, workspace }
          : undefined
        const verified = verification && verificationRequest
          ? verification.lookup(verificationRequest).pipe(
              Effect.catch(() => Effect.succeed(false)),
            )
          : Effect.succeed(false)

        return started.pipe(
          Effect.andThen(verified),
          Effect.flatMap((isVerified) => {
            if (isVerified) {
              node.verifiedCommands++
              return Effect.succeed(workspace)
            }

            node.executedCommands++
            const definitionOptions = definitions.get(stepId)?.options
            return commandExecutor.execute({
              command,
              onOutput: (stream, text) => {
                if (output !== "inherit") return
                if (stream === "stdout") process.stdout.write(text)
                else process.stderr.write(text)
              },
              options: definitionOptions ?? {},
              stepId,
              workflowId,
              workspace,
            }).pipe(
              Effect.tap(() => verification && verificationRequest
                ? verification.record(verificationRequest).pipe(Effect.ignore)
                : Effect.void),
              Effect.flatMap((result) => Effect.gen(function* () {
                if (result.stdout) {
                  yield* emitEvent({
                    type: "step.output",
                    workflowId,
                    stepId,
                    stream: "stdout",
                    text: result.stdout,
                    timestamp: new Date().toISOString(),
                  })
                }
                if (result.stderr) {
                  yield* emitEvent({
                    type: "step.output",
                    workflowId,
                    stepId,
                    stream: "stderr",
                    text: result.stderr,
                    timestamp: new Date().toISOString(),
                  })
                }

                return workspace
              })),
            )
          }),
        )
      },
      transformSources: (stepId, request) => {
        const node = nodes.get(stepId)
        if (!node) return Effect.die(new Error(`Missing plan node for ${stepId}`))

        node.sourceTransforms.push({
          files: Object.keys(request.files).sort(),
          tool: request.tool,
        })

        const requirements = definitions.get(stepId)?.options.execution ?? {
          capabilities: ["filesystem", "process"] as const,
          preference: "container" as const,
        }

        if (mode === "plan") {
          return Effect.succeed({
            changed: false,
            files: request.files,
            tier: "planned" as const,
          })
        }

        return sourceExecutor.execute({
          ...request,
          requirements,
          stepId,
          workflowId,
        })
      },
      readFile: (stepId, workspace, path) => workspaceFileSystem.readFile(
        workspace,
        path,
        stepId,
      ),
      exists: (stepId, workspace, path) => workspaceFileSystem.exists(
        workspace,
        path,
        stepId,
      ),
      checkpoint: (stepId, workspace, name) => {
        if (mode === "plan") {
          return Effect.succeed(new WorkspaceCheckpoint(
            name,
            workspace,
            { provider: "plan", value: undefined },
          ))
        }

        return workspacePersistence.checkpoint({
          name,
          stepId,
          workflowId,
          workspace,
        }).pipe(
          Effect.map((handle) => new WorkspaceCheckpoint(
            name,
            workspace.withRevision(handle),
            handle,
          )),
        )
      },
      restore: (stepId, checkpoint) => mode === "plan"
        ? Effect.succeed(checkpoint.workspace)
        : workspacePersistence.restore({ checkpoint, stepId, workflowId }),
      requestApproval: (stepId, request) => {
        const node = nodes.get(stepId)
        if (!node) return Effect.die(new Error(`Missing plan node for ${stepId}`))

        node.approval = request

        if (mode === "plan") {
          return Effect.succeed({ decision: "approved" as const })
        }

        if (!approvalHandler) {
          return Effect.fail(new ApprovalError(
            stepId,
            "unavailable",
            `No approval handler is available for ${stepId}`,
          ))
        }

        const requestId = `${workflowId}:${stepId}`
        const requested = emitEvent({
          type: "approval.requested",
          workflowId,
          stepId,
          requestId,
          approval: request,
          timestamp: new Date().toISOString(),
        })

        return requested.pipe(
          Effect.andThen(approvalHandler.request({
            ...request,
            requestId,
            stepId,
            workflowId,
          })),
          Effect.mapError((error) => error instanceof ApprovalError
            ? error
            : new ApprovalError(stepId, "unavailable", String(error))),
          Effect.flatMap((result) => {
            const resolved = emitEvent({
              type: "approval.resolved",
              workflowId,
              stepId,
              requestId,
              decision: result.decision,
              ...(result.actor ? { actor: result.actor } : {}),
              timestamp: new Date().toISOString(),
            })

            return resolved.pipe(
              Effect.andThen(result.decision === "approved"
                ? Effect.succeed(result)
                : Effect.fail(new ApprovalError(
                  stepId,
                  "rejected",
                  `${stepId} was rejected${result.actor ? ` by ${result.actor}` : ""}`,
                ))),
            )
          }),
        )
      },
    }

    return runtime
  })

export interface RunOptions {
  readonly approval?: ApprovalHandler
  readonly ci?: boolean
  readonly executor?: CommandExecutor
  readonly env?: string
  readonly event?: WorkflowEventShape
  readonly mode?: WorkflowPlan["mode"]
  readonly onAttempt?: WorkflowAttemptHandler
  readonly onEvent?: RuntimeEventHandler
  readonly output?: "inherit" | "silent"
  readonly rerun?: WorkflowRerun
  readonly secrets?: SecretResolver
  readonly source?: SourceService
  readonly sourceExecutor?: SourceExecutor
  readonly workspacePersistence?: WorkspacePersistence
  readonly workspaceFileSystem?: WorkspaceFileSystem
  readonly verification?: VerificationStore
}

export interface RunConfiguration extends RunOptions {
  readonly dispose?: () => Promise<void>
}

const toPlan = (
  workflowId: string,
  runtime: RuntimeShape,
  environment: string,
): WorkflowPlan => {
  const dependencies = new Map<string, Array<string>>()
  for (const edge of runtime.edges) {
    const [parent, child] = edge.split("->") as [string, string]
    const children = dependencies.get(parent) ?? []
    children.push(child)
    dependencies.set(parent, children)
  }

  const after = new Map<string, Array<string>>()
  for (const edge of runtime.afterEdges) {
    const [parent, child] = edge.split("->") as [string, string]
    const children = after.get(parent) ?? []
    children.push(child)
    after.set(parent, children)
  }

  const ordered: Array<RuntimeNode> = []
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    const prerequisites = [
      ...(dependencies.get(id) ?? []),
      ...(after.get(id) ?? []),
    ]
    for (const dependency of [...new Set(prerequisites)].sort()) visit(dependency)
    const node = runtime.nodes.get(id)
    if (node) ordered.push(node)
  }
  for (const id of [...runtime.nodes.keys()].sort()) visit(id)

  return {
    workflowId,
    environment,
    mode: runtime.mode,
    nodes: ordered.map((node) => ({
      id: node.id,
      after: [...(after.get(node.id) ?? [])].sort(),
      needs: [...(dependencies.get(node.id) ?? [])].sort(),
      commands: [...node.commands],
      sourceTransforms: [...node.sourceTransforms],
      artifacts: [...node.artifacts],
      ...(node.condition ? { condition: node.condition } : {}),
      ...(node.compensationFor ? { compensationFor: node.compensationFor } : {}),
      ...(node.approval ? { approval: node.approval } : {}),
      optional: runtime.optionalSteps.has(node.id),
      options: definitions.get(node.id)?.options ?? {},
      secrets: [...node.secrets].sort(),
      status: node.status,
    })),
  }
}

export const formatCondition = (condition: Condition): string => {
  switch (condition._tag) {
    case "event":
      return `event in [${condition.oneOf.join(", ")}]`
    case "ref":
      return `ref in [${condition.oneOf.join(", ")}]`
    case "all":
      return condition.conditions.map(formatCondition).join(" and ")
    case "any":
      return `(${condition.conditions.map(formatCondition).join(" or ")})`
    case "not":
      return `not (${formatCondition(condition.condition)})`
  }
}

export const formatPlan = (plan: WorkflowPlan): string => {
  const lines = [
    `CI ${plan.mode === "plan" ? "plan" : "execution summary"}: ${plan.workflowId}`,
    `Environment: ${plan.environment}`,
  ]

  for (const node of plan.nodes) {
    const after = node.after.length > 0 ? ` after ${node.after.join(", ")}` : ""
    const needs = node.needs.length > 0 ? ` needs ${node.needs.join(", ")}` : ""
    const optional = node.optional ? " (optional)" : ""
    const compensation = node.compensationFor
      ? ` compensates ${node.compensationFor}`
      : ""
    const suffix = `${needs}${after}${compensation}${optional}`
    const status = node.status === "complete"
      ? "✓"
      : node.status === "reused"
      ? "↻"
      : node.status === "verified"
      ? "◆"
      : node.status === "warning"
      ? "⚠"
      : node.status === "failed"
      ? "×"
      : node.status === "skipped"
      ? "–"
      : "○"
    lines.push("", `${status} ${node.id}${suffix}`)
    if (node.condition) {
      lines.push(`  if: ${formatCondition(node.condition)}`)
    }
    if (plan.mode === "plan") {
      if (node.approval) {
        lines.push(`  approval: ${node.approval.title}`)
      }
      if (node.secrets.length > 0) {
        lines.push(`  secrets: ${node.secrets.join(", ")}`)
      }
      for (const artifact of node.artifacts) {
        lines.push(
          `  artifact ${artifact.direction}: ${artifact.name} (${artifact.paths.join(", ")})`,
        )
      }
      for (const entry of node.commands) {
        lines.push(`  $ ${entry.command}`, `    cwd: ${entry.cwd}`)
      }
      for (const transform of node.sourceTransforms ?? []) {
        lines.push(`  ${transform.tool}: ${transform.files.join(", ")}`)
      }
    }
  }

  return lines.join("\n")
}

const interpret = <A>(
  workflowDefinition: Workflow<A>,
  mode: WorkflowPlan["mode"],
  options: RunOptions,
) =>
  Effect.gen(function* () {
    const environment = options.env ?? "development"
    const event: WorkflowEventShape = options.event ?? { type: "workflow_dispatch" }
    const emitEvent = makeEventEmitter(options.onEvent)
    const startedAt = new Date().toISOString()
    const previous = options.rerun?.previous

    if (previous && previous.workflowId !== workflowDefinition.id) {
      return yield* Effect.fail(new WorkflowPlanError(
        `Cannot rerun ${previous.workflowId} as ${workflowDefinition.id}`,
      ))
    }

    const selection = previous
      ? planRerun(previous.plan, options.rerun?.steps ?? [])
      : undefined
    const attemptNumber = previous ? previous.number + 1 : 1
    const attemptId = `${workflowDefinition.id}:${attemptNumber}:${globalThis.crypto.randomUUID()}`

    yield* emitEvent({
      type: "workflow.started",
      workflowId: workflowDefinition.id,
      environment,
      mode,
      timestamp: new Date().toISOString(),
    })

    const runtime = yield* makeRuntime(
      workflowDefinition.id,
      options.ci ?? (typeof process !== "undefined" && process.env.CI !== undefined),
      mode,
      options.output ?? "inherit",
      emitEvent,
      event,
      options.approval,
      options.executor ?? makeLocalCommandExecutor(),
      options.sourceExecutor,
      options.workspaceFileSystem,
      options.workspacePersistence,
      options.verification,
      previous && selection ? { previous, selection } : undefined,
    )
    const approval: ApprovalService = {
      request: (request) => Effect.gen(function* () {
        const currentRuntime = yield* Runtime
        const stepId = yield* CurrentStep

        return yield* currentRuntime.requestApproval(stepId, request)
      }),
    }
    const secrets: SecretResolver = options.secrets ?? {
      resolve: (name) => {
        const value = typeof process === "undefined" ? undefined : process.env[name]
        return value === undefined
          ? Effect.fail(new SecretError(name))
          : Effect.succeed(Redacted.make(value, { label: name }))
      },
    }
    const result = yield* workflowDefinition.effect.pipe(
      Effect.provideService(Runtime, runtime),
      Effect.provideService(CurrentStep, "$workflow"),
      Effect.provideService(Source, options.source ?? localSource),
      Effect.provideService(WorkflowEvent, event),
      Effect.provideService(Approval, approval),
      Effect.provideService(SecretStore, secrets),
      Effect.exit,
    )

    const plan = toPlan(
      workflowDefinition.id,
      runtime,
      environment,
    )
    const completedAt = new Date().toISOString()
    const attempt = Object.freeze({
      id: attemptId,
      number: attemptNumber,
      workflowId: workflowDefinition.id,
      ...(previous ? { previousAttemptId: previous.id } : {}),
      requested: Object.freeze([...(selection?.requested ?? [])]),
      plan,
      outputs: Object.freeze(Object.fromEntries(runtime.outputs)),
      conclusion: Exit.isFailure(result) ? "failure" as const : "success" as const,
      startedAt,
      completedAt,
    }) satisfies WorkflowAttempt
    yield* emitEvent({
      type: "workflow.plan",
      workflowId: workflowDefinition.id,
      plan,
      timestamp: new Date().toISOString(),
    })

    if (Exit.isFailure(result)) {
      yield* emitEvent({
        type: "workflow.completed",
        workflowId: workflowDefinition.id,
        conclusion: "failure",
        timestamp: new Date().toISOString(),
      })
      yield* publishAttempt(options.onAttempt, attempt)
      return yield* Effect.failCause(result.cause)
    }

    yield* emitEvent({
      type: "workflow.completed",
      workflowId: workflowDefinition.id,
      conclusion: "success",
      timestamp: new Date().toISOString(),
    })
    yield* publishAttempt(options.onAttempt, attempt)

    return { attempt, plan, value: result.value }
  })

export const run = <A>(workflowDefinition: Workflow<A>, options: RunOptions = {}) =>
  interpret(workflowDefinition, options.mode ?? "execute", options).pipe(
    Effect.tap(({ plan }) => options.output === "silent"
      ? Effect.void
      : Effect.sync(() => console.log(`\n${formatPlan(plan)}`))),
  )

export const runPromise = <A>(workflowDefinition: Workflow<A>, options?: RunOptions) =>
  Effect.runPromise(run(workflowDefinition, options))
