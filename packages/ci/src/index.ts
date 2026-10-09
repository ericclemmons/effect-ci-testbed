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

export type StepOptions = WorkflowStepConfig

export interface CheckOptions extends StepOptions {
  /** Allow a trusted runner to reuse this side-effect-free check for the same commit. */
  readonly reuse?: { readonly scope: "commit" }
}

type InternalStepOptions = StepOptions & Pick<CheckOptions, "reuse">

export interface ActionOptions extends StepOptions {
  /**
   * Reverses external state introduced by this action. Rollbacks run after the
   * action exhausts its retries, then unwind in reverse completion order.
   */
  readonly rollback?: ActionTarget
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

/** An action factory that can be exposed as a zero-argument CLI target. */
export type ActionTarget = () => Effect.Effect<unknown, unknown, any>

interface StepDefinition<A = unknown> {
  readonly identity?: object
  readonly id: string
  readonly body: Effect.Effect<A, unknown, Runtime | CurrentStep>
  readonly prepare?: Effect.Effect<Effect.Effect<A, unknown, any>, unknown, any>
  readonly options: InternalStepOptions
  readonly rollback?: {
    readonly id: string
    readonly effect: Effect.Effect<unknown, unknown, any>
  }
}

export interface PlannedCommand {
  readonly command: string
  readonly cwd: string
}

export interface PlanNode {
  readonly id: string
  readonly after: ReadonlyArray<string>
  readonly dependencies: ReadonlyArray<string>
  readonly commands: ReadonlyArray<PlannedCommand>
  readonly condition?: Condition
  /** This node runs only after the referenced node exhausts its retry policy. */
  readonly rollbackFor?: string
  readonly approval?: ApprovalRequest
  readonly artifacts: ReadonlyArray<{
    readonly direction: "publish" | "restore"
    readonly name: string
    readonly paths: ReadonlyArray<string>
  }>
  readonly optional: boolean
  readonly options: InternalStepOptions
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
 * Selects the requested nodes and everything that transitively consumes them.
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
    for (const dependency of node.dependencies) {
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
      readonly dependency: string
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
  approval?: ApprovalRequest
  condition?: Condition
  rollbackFor?: string
  readonly secrets: Set<string>
  executedCommands: number
  verifiedCommands: number
  status: PlanNode["status"]
}

interface RuntimeShape {
  readonly definitions: Map<string, StepDefinition>
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
  readonly registerRollback: (
    primaryId: string,
    rollbackId: string,
    rollback: Effect.Effect<unknown, unknown, any>,
  ) => Effect.Effect<void, unknown, any>
  readonly unwind: (original: unknown) => Effect.Effect<undefined, RollbackError>
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

/** One-based attempt supplied by the local or durable policy interpreter. */
export class Attempt extends ServiceMap.Service<Attempt, number>()("@effect-ci-testbed/Attempt") {}
class PolicyBody extends ServiceMap.Service<PolicyBody, boolean>()("@effect-ci-testbed/PolicyBody") {}

export interface ActionExecutionResult {
  readonly value: unknown
  readonly commands: ReadonlyArray<PlannedCommand>
  readonly events?: ReadonlyArray<RuntimeEvent>
  readonly metadata?: Pick<PlanNode, "artifacts" | "secrets" | "approval">
}

/** Runner boundary for a policy-bearing leaf body, after dependencies resolve. */
export interface ActionExecutor {
  readonly execute: (request: {
    readonly stepId: string
    readonly options: WorkflowStepConfig
    readonly run: (attempt: number) => Effect.Effect<ActionExecutionResult, unknown, any>
  }) => Effect.Effect<ActionExecutionResult, unknown, any>
}

export class CommandError extends Error {
  readonly _tag = "CommandError"
  readonly stepId: string
  readonly command: string
  readonly cwd: string
  readonly exitCode: number
  readonly details: string | undefined

  constructor(
    stepId: string,
    command: string,
    cwd: string,
    exitCode: number,
    details?: string,
  ) {
    super(`Command failed (${exitCode}): ${command}${details ? `\n${details}` : ""}`)
    this.stepId = stepId
    this.command = command
    this.cwd = cwd
    this.exitCode = exitCode
    this.details = details
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

export class RollbackError extends Error {
  readonly _tag = "RollbackError"
  readonly stepId: string
  readonly original: unknown
  readonly rollback: unknown

  constructor(
    stepId: string,
    original: unknown,
    rollback: unknown,
  ) {
    super(`Rollback for ${stepId} failed after the original action failed`, {
      cause: new AggregateError([original, rollback]),
    })
    this.stepId = stepId
    this.original = original
    this.rollback = rollback
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

  directory(path: string): Workspace {
    if (!path || path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`Workspace directory must be relative: ${path}`)
    }

    return new Workspace(join(this.cwd, path), this.kind, this.id, this.revision)
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

    // A selected project must not accidentally install a parent monorepo using
    // a different lockfile. A workspace root with its own manifest stays recursive.
    const standalonePnpm = name === "pnpm" && !(yield* workspace.exists("pnpm-workspace.yaml"))
    const executable = name === "pnpm" && standalonePnpm ? "pnpm --ignore-workspace" : name

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
                return `${executable} install --store-dir .effect-ci/cache/pnpm${offlineFlag}`
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
              return `${executable} install --frozen-lockfile --store-dir .effect-ci/cache/pnpm${offlineFlag}`
            case "yarn":
              return `YARN_CACHE_FOLDER=.effect-ci/cache/yarn yarn install --immutable${offlineFlag}`
            case "bun":
              return `bun install --frozen-lockfile --cache-dir .effect-ci/cache/bun${offlineFlag}`
          }
        }
        case "run":
          return `${executable} run ${JSON.stringify(value)}`
        case "exec":
          return name === "bun"
            ? `bunx ${value}`
            : `${executable} exec ${value}`
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
  /** Acquire the repository and immutable revision selected by the initiating event. */
  readonly checkout: () => Effect.Effect<Workspace, unknown>
  /** Provider-neutral provenance for logs, evidence, and cache identity. */
  readonly reference?: SourceReference
}

export class Source extends ServiceMap.Service<Source, SourceService>()(
  "@effect-ci-testbed/Source",
) {}

const localSource: SourceService = {
  checkout: () => Effect.succeed(Workspace.local(process.cwd())),
  reference: { kind: "local", path: process.cwd() },
}

export interface CommandExecutionRequest {
  readonly command: string
  /** Position in the action, including commands reused by a check-cache layer. */
  readonly commandIndex?: number
  readonly onOutput: (stream: "stdout" | "stderr", text: string) => void
  readonly options: WorkflowStepConfig
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

export interface CheckCacheRequest {
  readonly command: string
  readonly event: WorkflowEventShape
  readonly policy: { readonly scope: "commit" }
  readonly stepId: string
  readonly workflowId: string
  readonly workspace: Workspace
}

/** Runner policy for reusing side-effect-free checks with the same exact inputs. */
export interface CheckCache {
  readonly lookup: (request: CheckCacheRequest) => Effect.Effect<boolean, unknown>
  readonly record: (request: CheckCacheRequest) => Effect.Effect<void, unknown>
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
  readonly id: string
  readonly effect: Effect.Effect<A, unknown, Runtime | CurrentStep | WorkflowEvent | Approval>
}

/** Runner-owned reusable workspace cache policy. */
export interface WorkspaceCachePolicy {
  readonly key: string
  readonly keyFiles: ReadonlyArray<string>
  readonly paths: ReadonlyArray<string>
}

export type WorkflowEventName =
  | "deploy_hook"
  | "deployment"
  | "deployment_status"
  | "merge_group"
  | "observability_issue"
  | "pull_request"
  | "push"
  | "release"
  | "workflow_dispatch"

export type SourceReference =
  | {
      readonly kind: "artifact"
      readonly digest: string
      readonly name: string
    }
  | {
      readonly kind: "durable_object"
      readonly id: string
      readonly revision: string
    }
  | {
      readonly kind: "git"
      readonly repository: string
      readonly revision: string
    }
  | {
      readonly kind: "local"
      readonly path: string
      readonly revision?: string
    }
  | {
      readonly kind: "r2"
      readonly bucket: string
      readonly digest: string
      readonly key: string
    }

export interface WorkflowEventShape {
  readonly type: WorkflowEventName
  readonly payload?: unknown
  /** Source selected by the event adapter. Non-source events may omit it. */
  readonly source?: SourceReference
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

const actionDefinitions = new WeakMap<object, StepDefinition>()

const registerDefinition = (runtime: RuntimeShape, definition: StepDefinition): void => {
  const existing = runtime.definitions.get(definition.id)
  if (existing && existing !== definition &&
      (!definition.identity || existing.identity !== definition.identity)) {
    throw new Error(`Duplicate CI action id: ${definition.id}`)
  }
  if (!existing) runtime.definitions.set(definition.id, definition)
}

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
}

const runStep = <A>(
  definition: StepDefinition,
  dependencies: ReadonlyArray<string> = [],
): Effect.Effect<A, unknown, Runtime | CurrentStep> => {
  const id = definition.id
  const effect = Effect.gen(function* () {
    const boundary = yield* Effect.serviceOption(PolicyBody)
    if (boundary._tag === "Some" && boundary.value) {
      return yield* Effect.fail(new WorkflowPlanError(
        `Resolve dependency ${id} during action construction, before returning the policy-bearing body`,
      ))
    }
    const runtime = yield* Runtime
    registerDefinition(runtime, definition)
    const parent = yield* CurrentStep
    yield* runtime.addDependency(parent, id)
    for (const dependency of dependencies) {
      yield* runtime.addDependency(id, dependency)
    }
    return (yield* Cache.get(runtime.cache, id)) as A
  })
  actionIds.set(effect as object, id)
  actionDefinitions.set(effect as object, definition)
  return effect
}

const actionIds = new WeakMap<object, string>()
const actionFactories = new WeakSet<Function>()
const actionFactoryIds = new WeakMap<Function, string>()
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
  const definition = actionDefinitions.get(effect as object)
  if (definition) actionDefinitions.set(optionalEffect as object, definition)
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
    const definition = actionDefinitions.get(effect as object)
    if (definition) registerDefinition(runtime, definition)
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
  const definition = actionDefinitions.get(effect as object)
  if (definition) actionDefinitions.set(conditional as object, definition)
  return conditional
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
  return runStep({ id, body: bodyToEffect(body), options })
}

export const action = <
  A = Workspace,
  Args extends ReadonlyArray<unknown> = ReadonlyArray<never>,
>(
  id: string,
  construction: ActionConstruction<Args, NoInfer<A>>,
  options: ActionOptions = {},
): ((...args: Args) => Effect.Effect<A, unknown, Runtime | CurrentStep>) => {
  const identity = {}

  const factory = (...args: Args): Effect.Effect<A, unknown, Runtime | CurrentStep> => {
    validateStepOptions(id, options)
    const rollback = options.rollback
      ? (() => {
          const rollbackEffect = options.rollback!()
          const rollbackId = actionFactoryIds.get(options.rollback!)
          if (!rollbackId) {
            throw new Error(`Rollback for ${id} must be a CI action`)
          }
          return { id: rollbackId, effect: rollbackEffect }
        })()
      : undefined
    const { rollback: _rollback, ...stepOptions } = options
    const definition: StepDefinition = {
      identity,
      id,
      body: bodyToEffect(construction).pipe(
        Effect.flatMap((handler) => bodyToEffect(() => handler(...args))),
      ),
      prepare: bodyToEffect(construction).pipe(
        Effect.map((handler) => bodyToEffect(() => handler(...args))),
      ),
      options: stepOptions,
      ...(rollback ? { rollback } : {}),
    }
    return runStep(definition)
  }

  actionFactories.add(factory)
  actionFactoryIds.set(factory, id)
  return factory
}

/**
 * A side-effect-free assertion whose success can be reused by a trusted runner.
 * Checks return no workspace revision or domain output: they either succeed or fail.
 */
export const check = <Args extends ReadonlyArray<unknown> = ReadonlyArray<never>>(
  id: string,
  construction: ActionConstruction<Args, void>,
  options: CheckOptions = {},
): ((...args: Args) => Effect.Effect<void, unknown, Runtime | CurrentStep>) =>
  action<void, Args>(id, construction, options as ActionOptions)

/** Identifies action factories exported as direct CLI targets. */
export const isAction = (value: unknown): value is ActionTarget =>
  typeof value === "function" && actionFactories.has(value)

export const workflow = <A>(
  id: string,
  body: WorkflowBody<A>,
): Workflow<A> => ({
  id,
  effect: bodyToEffect(body),
})

const makeLocalCommandExecutor = (output: "inherit" | "silent" = "inherit"): CommandExecutor => ({
  execute: ({ command, onOutput, stepId, workspace }) => Effect.callback<CommandExecutionResult, CommandError>((resume) => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const colorDepth = output === "inherit"
      && process.env.FORCE_COLOR === undefined
      && process.env.NO_COLOR === undefined
      && process.env.NODE_DISABLE_COLORS === undefined
      ? Math.max(
          process.stdout.isTTY ? process.stdout.getColorDepth() : 1,
          process.stderr.isTTY ? process.stderr.getColorDepth() : 1,
        )
      : 1
    const child = spawn(command, {
      cwd: workspace.cwd,
      env: colorDepth > 1
        ? { ...process.env, FORCE_COLOR: colorDepth >= 24 ? "3" : colorDepth >= 8 ? "2" : "1" }
        : process.env,
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

const withStepPolicy = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: WorkflowStepConfig,
): Effect.Effect<A, any, R> => {
  let attempt = 0
  const effectBody = effect
  effect = Effect.suspend(() => effectBody.pipe(Effect.provideService(Attempt, ++attempt))) as Effect.Effect<A, E, R>
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
  commandExecutor: CommandExecutor = makeLocalCommandExecutor(output),
  workspaceFileSystem: WorkspaceFileSystem = localWorkspaceFileSystem,
  workspacePersistence: WorkspacePersistence = {
    commit: ({ workspace }) => Effect.succeed(workspace),
    checkpoint: () => Effect.succeed({ provider: "local", value: undefined }),
    restore: ({ checkpoint }) => Effect.succeed(checkpoint.workspace),
  },
  checkCache?: CheckCache,
  rerun?: {
    readonly previous: WorkflowAttempt
    readonly selection: WorkflowRerunPlan
  },
  actionExecutor?: ActionExecutor,
) =>
  Effect.gen(function* () {
    const definitions = new Map<string, StepDefinition>()
    const bufferedEvents = new Map<string, Array<RuntimeEvent>>()
    const emitOutsideBody = emitEvent
    emitEvent = (event) => {
      const buffer = "stepId" in event ? bufferedEvents.get(event.stepId) : undefined
      return buffer ? Effect.sync(() => { buffer.push(event) }) : emitOutsideBody(event)
    }
    const nodes = new Map<string, RuntimeNode>()
    const afterEdges = new Set<string>()
    const edges = new Set<string>()
    const failureOrigins = new Map<unknown, string>()
    const optionalSteps = new Set<string>()
    const outputs = new Map<string, unknown>()
    const parallelSteps = new Set<string>()
    const completedRollbacks: Array<{
      readonly primaryId: string
      readonly rollbackId: string
      readonly effect: Effect.Effect<unknown, unknown, any>
    }> = []
    const reusable = new Set(rerun?.selection.reuse ?? [])
    const previousNodes = new Map(
      rerun?.previous.plan.nodes.map((node) => [node.id, node]) ?? [],
    )
    let workflowBarrier: {
      readonly after: ReadonlyArray<string>
      readonly dependencies: ReadonlyArray<string>
    } = { after: [], dependencies: [] }
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

      for (const dependency of previousNode.dependencies) edges.add(`${id}->${dependency}`)
      for (const dependency of previousNode.after) afterEdges.add(`${id}->${dependency}`)
      if (previousNode.optional) optionalSteps.add(id)
      nodes.set(id, {
        id,
        artifacts: [...(previousNode.artifacts ?? [])],
        commands: [...previousNode.commands],
        ...(previousNode.approval ? { approval: previousNode.approval } : {}),
        ...(previousNode.condition ? { condition: previousNode.condition } : {}),
        ...(previousNode.rollbackFor
          ? { rollbackFor: previousNode.rollbackFor }
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
          secrets: new Set(),
          executedCommands: 0,
          verifiedCommands: 0,
          status: "planned" as const,
        }
        nodes.set(id, node)

        if (reusable.has(id)) {
          const reused = Effect.succeed(outputs.get(id))
          if (!definition.rollback || mode !== "execute") return reused

          return runtime.registerRollback(
            id,
            definition.rollback.id,
            definition.rollback.effect,
          ).pipe(
            Effect.tap(() => Effect.sync(() => {
              completedRollbacks.push({
                primaryId: id,
                rollbackId: definition.rollback!.id,
                effect: definition.rollback!.effect,
              })
            })),
            Effect.andThen(reused),
          )
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

        const prepared = definition.prepare ?? Effect.succeed(definition.body)
        const commit = (value: unknown) => mode === "execute" && value instanceof Workspace
          ? workspacePersistence.commit({ stepId: id, workflowId, workspace: value })
          : Effect.succeed(value)
        const body = prepared.pipe(Effect.flatMap((leaf) => {
          if (mode === "execute" && actionExecutor &&
            (definition.options.retries !== undefined || definition.options.timeout !== undefined)) {
            node.status = "running"
            const started = emitEvent({ type: "step.status", workflowId, stepId: id,
              status: "running", optional: optionalSteps.has(id), timestamp: new Date().toISOString() })
            return started.pipe(Effect.andThen(actionExecutor.execute({
              stepId: id,
              options: definition.options,
              run: (attempt) => Effect.sync(() => {
                node.commands.length = 0
                bufferedEvents.set(id, [])
              }).pipe(
                Effect.andThen(leaf),
                Effect.flatMap(commit),
                Effect.map((value) => ({ value, commands: [...node.commands], events: [...bufferedEvents.get(id)!],
                  metadata: { artifacts: [...node.artifacts], secrets: [...node.secrets],
                    ...(node.approval ? { approval: node.approval } : {}) } })),
                Effect.provideService(Attempt, attempt),
                Effect.provideService(PolicyBody, true),
              ),
            })), Effect.tap((result) => {
              bufferedEvents.delete(id)
              return Effect.forEach(result.events ?? [], emitOutsideBody, { discard: true })
            }), Effect.ensuring(Effect.sync(() => { bufferedEvents.delete(id) })), Effect.map((result) => {
              node.commands.splice(0, node.commands.length, ...result.commands)
              if (result.metadata) {
                node.artifacts.splice(0, node.artifacts.length, ...result.metadata.artifacts)
                node.secrets.clear()
                for (const secret of result.metadata.secrets) node.secrets.add(secret)
                if (result.metadata.approval) node.approval = result.metadata.approval
              }
              return result.value
            }))
          }
          return (commandExecutor.handlesStepOptions ? leaf : withStepPolicy(leaf, definition.options))
            .pipe(Effect.flatMap(commit))
        }))

        return queued.pipe(
          Effect.andThen(body),
          Effect.provideService(CurrentStep, id),
          Effect.tap((value) => Effect.sync(() => {
            outputs.set(id, value)
          })),
          Effect.tap(() => {
            if (!definition.rollback) return Effect.void

            if (mode === "plan") {
              return runtime.registerRollback(
                id,
                definition.rollback.id,
                definition.rollback.effect,
              )
            }

            return runtime.registerRollback(
              id,
              definition.rollback.id,
              definition.rollback.effect,
            ).pipe(Effect.tap(() => Effect.sync(() => {
              completedRollbacks.push({
                primaryId: id,
                rollbackId: definition.rollback!.id,
                effect: definition.rollback!.effect,
              })
            })))
          }),
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
      definitions,
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
          for (const dependency of workflowBarrier.dependencies) {
            edges.add(`${child}->${dependency}`)
          }
          for (const dependency of workflowBarrier.after) {
            afterEdges.add(`${child}->${dependency}`)
          }
          workflowBarrier = optionalSteps.has(child)
            ? { after: [child], dependencies: [] }
            : { after: [], dependencies: [child] }
          return
        }
        edges.add(`${parent}->${child}`)
        yield* emitEvent({
          type: "dependency.added",
          workflowId,
          stepId: parent,
          dependency: child,
          timestamp: new Date().toISOString(),
        })
      }),
      addParallel: (parent, steps) => Effect.sync(() => {
        if (parent !== "$workflow") return
        for (const step of steps) {
          if (step.optional) optionalSteps.add(step.id)
          parallelSteps.add(step.id)
          for (const dependency of workflowBarrier.dependencies) {
            edges.add(`${step.id}->${dependency}`)
          }
          for (const dependency of workflowBarrier.after) {
            afterEdges.add(`${step.id}->${dependency}`)
          }
        }
        workflowBarrier = {
          after: steps.filter((step) => step.optional).map((step) => step.id),
          dependencies: steps.filter((step) => !step.optional).map((step) => step.id),
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
      registerRollback: (primaryId, rollbackId, rollback) => Effect.gen(function* () {
        const node = nodes.get(rollbackId) ?? {
          id: rollbackId,
          artifacts: [],
          commands: [],
          secrets: new Set(),
          executedCommands: 0,
          verifiedCommands: 0,
          status: mode === "plan" ? "planned" as const : "skipped" as const,
        }
        node.rollbackFor = primaryId
        nodes.set(rollbackId, node)

        if (mode !== "plan") return

        const barrier = workflowBarrier
        workflowBarrier = { after: [], dependencies: [] }
        yield* rollback.pipe(
          Effect.provideService(CurrentStep, "$rollback"),
          Effect.asVoid,
          Effect.ensuring(Effect.sync(() => {
            workflowBarrier = barrier
          })),
        )
        const planned = nodes.get(rollbackId)
        if (planned) planned.rollbackFor = primaryId
      }),
      unwind: (original) => Effect.gen(function* () {
        if (mode !== "execute") return

        const failedId = failureOrigins.get(original)
        const failedRollback = failedId
          ? definitions.get(failedId)?.rollback
          : undefined
        const rollbacks = [
          ...(failedId && failedRollback
            ? [{
                primaryId: failedId,
                rollbackId: failedRollback.id,
                effect: failedRollback.effect,
              }]
            : []),
          ...[...completedRollbacks].reverse().filter(
            ({ primaryId }) => primaryId !== failedId,
          ),
        ]
        const failures: Array<unknown> = []

        for (const rollback of rollbacks) {
          yield* runtime.registerRollback(
            rollback.primaryId,
            rollback.rollbackId,
            rollback.effect,
          ).pipe(Effect.orDie)
          yield* rollback.effect.pipe(
            Effect.provideService(CurrentStep, "$rollback"),
            Effect.matchEffect({
              onFailure: (error) => Effect.sync(() => {
                failures.push(error)
              }),
              onSuccess: () => Effect.void,
            }),
          )
        }

        if (failures.length > 0) {
          return yield* Effect.fail(new RollbackError(
            failedId ?? "workflow",
            original,
            failures.length === 1 ? failures[0] : new AggregateError(failures),
          ))
        }
      }) as Effect.Effect<undefined, RollbackError>,
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
        const commandIndex = node.commands.length

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

        const policy = definitions.get(stepId)?.options.reuse
        const checkCacheRequest = policy
          ? { command, event, policy, stepId, workflowId, workspace }
          : undefined
        const verified = checkCache && checkCacheRequest
          ? checkCache.lookup(checkCacheRequest).pipe(
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
              commandIndex,
              onOutput: (stream, text) => {
                if (output !== "inherit") return
                if (stream === "stdout") process.stdout.write(text)
                else process.stderr.write(text)
              },
              options: {
                ...(definitionOptions?.retries
                  ? { retries: definitionOptions.retries }
                  : {}),
                ...(definitionOptions?.timeout === undefined
                  ? {}
                  : { timeout: definitionOptions.timeout }),
              },
              stepId,
              workflowId,
              workspace,
            }).pipe(
              Effect.tap(() => checkCache && checkCacheRequest
                ? checkCache.record(checkCacheRequest).pipe(Effect.ignore)
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
  readonly actionExecutor?: ActionExecutor
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
  readonly workspacePersistence?: WorkspacePersistence
  readonly workspaceFileSystem?: WorkspaceFileSystem
  readonly checkCache?: CheckCache
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
      dependencies: [...(dependencies.get(node.id) ?? [])].sort(),
      commands: [...node.commands],
      artifacts: [...node.artifacts],
      ...(node.condition ? { condition: node.condition } : {}),
      ...(node.rollbackFor ? { rollbackFor: node.rollbackFor } : {}),
      ...(node.approval ? { approval: node.approval } : {}),
      optional: runtime.optionalSteps.has(node.id),
      options: runtime.definitions.get(node.id)?.options ?? {},
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
    const dependencies = node.dependencies.length > 0
      ? ` depends on ${node.dependencies.join(", ")}`
      : ""
    const optional = node.optional ? " (optional)" : ""
    const rollback = node.rollbackFor
      ? ` rolls back ${node.rollbackFor}`
      : ""
    const suffix = `${dependencies}${after}${rollback}${optional}`
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
    }
  }

  return lines.join("\n")
}

const mermaidId = (id: string): string =>
  `step_${id.replaceAll(/[^a-zA-Z0-9_]/g, "_")}`

/** Render the inspectable dependency graph without coupling it to a CI provider UI. */
export const formatPlanMermaid = (plan: WorkflowPlan): string => {
  const lines = ["flowchart LR"]

  for (const node of plan.nodes) {
    const qualifiers = [
      node.optional ? "optional" : undefined,
      node.condition ? "conditional" : undefined,
    ].filter((value): value is string => value !== undefined)
    const label = qualifiers.length > 0
      ? `${node.id} (${qualifiers.join(", ")})`
      : node.id
    lines.push(`  ${mermaidId(node.id)}[${JSON.stringify(label)}]`)
  }

  for (const node of plan.nodes) {
    for (const dependency of node.dependencies) {
      lines.push(`  ${mermaidId(dependency)} --> ${mermaidId(node.id)}`)
    }
    for (const predecessor of node.after) {
      lines.push(`  ${mermaidId(predecessor)} -.-> ${mermaidId(node.id)}`)
    }
    if (node.rollbackFor) {
      lines.push(
        `  ${mermaidId(node.rollbackFor)} -. rollback .-> ${mermaidId(node.id)}`,
      )
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
      options.executor ?? makeLocalCommandExecutor(options.output),
      options.workspaceFileSystem,
      options.workspacePersistence,
      options.checkCache,
      previous && selection ? { previous, selection } : undefined,
      options.actionExecutor,
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
      Effect.catch((original) => runtime.unwind(original).pipe(
        Effect.flatMap(() => Effect.fail(original)),
      )),
      Effect.provideService(Runtime, runtime),
      Effect.provideService(CurrentStep, "$workflow"),
      Effect.provideService(PolicyBody, false),
      Effect.provideService(Attempt, 1),
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

/** Infer the same conventional task graph from a local or immutable source manifest. */
export const fromPackageJson = (manifest: {
  readonly name?: string
  readonly scripts?: Readonly<Record<string, string>>
}) => {
  const names = ["format", "lint", "check", "typecheck", "test", "build"]
    .filter((name) => manifest.scripts?.[name])
  if (names.length === 0) {
    throw new Error("Zero-config CI found no format, lint, check, typecheck, test, or build scripts")
  }

  const checkout = action("checkout", function* () {
    const source = yield* Source
    return () => source.checkout()
  })
  const install = action("install", () => function* () {
    const workspace = yield* checkout()
    const packageManager = yield* PackageManager.JavaScript(workspace)
    return yield* packageManager.install()
  })
  const actions = Object.fromEntries(names.map((name) => [name,
    action(name, () => function* () {
      const workspace = yield* install()
      const packageManager = yield* PackageManager.JavaScript(workspace)
      return yield* packageManager.run(name)
    }),
  ]))

  return {
    actions,
    workflow: workflow(manifest.name ?? "ci", function* () {
      let workspace: Workspace | undefined
      for (const name of names) workspace = yield* actions[name]!()
      return workspace
    }),
  }
}
