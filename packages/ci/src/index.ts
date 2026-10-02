import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeSync } from "node:fs"
import { join } from "node:path"
import * as Cache from "effect/Cache"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as ServiceMap from "effect/ServiceMap"

export interface WorkflowStepConfig {
  readonly retries?: {
    readonly limit: number
    readonly delay: string | number
    readonly backoff?: "constant" | "linear" | "exponential"
  }
  readonly timeout?: string | number
}

export interface StepOptions extends WorkflowStepConfig {
  readonly cache?: boolean | "auto"
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

export interface PlanNode {
  readonly id: string
  readonly after: ReadonlyArray<string>
  readonly needs: ReadonlyArray<string>
  readonly commands: ReadonlyArray<PlannedCommand>
  readonly approval?: ApprovalRequest
  readonly optional: boolean
  readonly options: StepOptions
  readonly status: "planned" | "queued" | "running" | "complete" | "warning" | "failed" | "skipped"
}

export interface WorkflowPlan {
  readonly workflowId: string
  readonly environment: string
  readonly mode: "plan" | "execute"
  readonly nodes: ReadonlyArray<PlanNode>
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
  readonly commands: Array<PlannedCommand>
  approval?: ApprovalRequest
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
  readonly cache: Cache.Cache<string, unknown, unknown, Runtime>
  readonly addDependency: (parent: string, child: string) => Effect.Effect<void>
  readonly addParallel: (
    parent: string,
    steps: ReadonlyArray<{ readonly id: string; readonly optional: boolean }>,
  ) => Effect.Effect<void>
  readonly markOptional: (stepId: string) => Effect.Effect<void>
  readonly recoverOptional: (stepId: string) => Effect.Effect<boolean>
  readonly execute: (
    stepId: string,
    workspace: Workspace,
    command: string,
  ) => Effect.Effect<Workspace, CommandError>
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

class Runtime extends ServiceMap.Service<Runtime, RuntimeShape>()(
  "@effect-ci-testbed/Runtime",
) {}

class CurrentStep extends ServiceMap.Service<CurrentStep, string>()(
  "@effect-ci-testbed/CurrentStep",
) {}

export class CommandError extends Error {
  readonly _tag = "CommandError"

  constructor(
    readonly stepId: string,
    readonly command: string,
    readonly cwd: string,
    readonly exitCode: number,
  ) {
    super(`Command failed (${exitCode}): ${command}`)
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

  constructor(
    readonly stepId: string,
    readonly decision: "rejected" | "unavailable",
    message: string,
  ) {
    super(message)
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
  private constructor(
    readonly cwd: string,
    readonly kind: WorkspaceKind,
    readonly id?: string,
    readonly revision?: WorkspaceCheckpointHandle,
  ) {}

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
  constructor(
    readonly name: string,
    readonly workspace: Workspace,
    readonly handle: WorkspaceCheckpointHandle,
  ) {}

  restore(): Effect.Effect<Workspace, unknown, Runtime | CurrentStep> {
    const checkpoint = this

    return Effect.gen(function* () {
      const runtime = yield* Runtime
      const stepId = yield* CurrentStep

      return yield* runtime.restore(stepId, checkpoint)
    })
  }
}

export class PackageManagerError extends Error {
  readonly _tag = "PackageManagerError"

  constructor(readonly cwd: string, message: string) {
    super(message)
  }
}

export namespace PackageManager {
  export type JavaScriptName = "npm" | "pnpm" | "yarn" | "bun"

  export interface InstallOptions {
    readonly frozenLockfile?: boolean
  }

  export interface JavaScript {
    readonly name: JavaScriptName
    readonly workspace: Workspace
    readonly install: (
      options?: InstallOptions,
    ) => Effect.Effect<Workspace, CommandError, Runtime | CurrentStep>
    readonly run: (script: string) => Effect.Effect<Workspace, CommandError, Runtime | CurrentStep>
    readonly exec: (command: string) => Effect.Effect<Workspace, CommandError, Runtime | CurrentStep>
  }

  const fromPackageManagerField = (workspace: Workspace): JavaScriptName | undefined => {
    const packageJson = join(workspace.cwd, "package.json")
    if (!existsSync(packageJson)) return undefined
    const contents = JSON.parse(readFileSync(packageJson, "utf8")) as {
      readonly packageManager?: string
    }
    const name = contents.packageManager?.split("@")[0]
    return name === "npm" || name === "pnpm" || name === "yarn" || name === "bun"
      ? name
      : undefined
  }

  const fromLockfile = (workspace: Workspace): JavaScriptName | undefined => {
    const matches = ([
      ["npm", "package-lock.json"],
      ["pnpm", "pnpm-lock.yaml"],
      ["yarn", "yarn.lock"],
      ["bun", "bun.lock"],
      ["bun", "bun.lockb"],
    ] as const).filter(([, file]) => existsSync(join(workspace.cwd, file)))
    const names = [...new Set(matches.map(([name]) => name))]
    if (names.length > 1) {
      throw new PackageManagerError(
        workspace.cwd,
        `Multiple JavaScript package-manager lockfiles found: ${names.join(", ")}`,
      )
    }
    return names[0]
  }

  export const JavaScript = (workspace: Workspace): Effect.Effect<JavaScript, PackageManagerError> =>
    Effect.try({
      try: () => {
        const name = fromPackageManagerField(workspace) ?? fromLockfile(workspace)
        if (!name) {
          throw new PackageManagerError(
            workspace.cwd,
            "Could not detect a JavaScript package manager from packageManager or a lockfile",
          )
        }

        const command = (
          operation: "install" | "run" | "exec",
          value?: string,
          frozenLockfile = false,
        ) => {
          switch (operation) {
            case "install":
              if (!frozenLockfile) return `${name} install`
              switch (name) {
                case "npm":
                  return "npm ci"
                case "pnpm":
                  return "pnpm install --frozen-lockfile"
                case "yarn":
                  return "yarn install --immutable"
                case "bun":
                  return "bun install --frozen-lockfile"
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
          install: (options) => Effect.gen(function* () {
            const runtime = yield* Runtime
            const frozenLockfile = options?.frozenLockfile ?? runtime.ci

            return yield* workspace.exec(command("install", undefined, frozenLockfile))
          }),
          run: (script) => workspace.exec(command("run", script)),
          exec: (executable) => workspace.exec(command("exec", executable)),
        }
      },
      catch: (error) => error instanceof PackageManagerError
        ? error
        : new PackageManagerError(workspace.cwd, String(error)),
    })
}

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
  readonly execute: (
    request: CommandExecutionRequest,
  ) => Effect.Effect<CommandExecutionResult, CommandError>
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

export type WorkflowEventName =
  | "merge_group"
  | "pull_request"
  | "push"
  | "release"
  | "workflow_dispatch"

export interface WorkflowEventShape {
  readonly type: WorkflowEventName
  readonly payload?: unknown
}

export class WorkflowEvent extends ServiceMap.Service<WorkflowEvent, WorkflowEventShape>()(
  "@effect-ci-testbed/WorkflowEvent",
) {}

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
): Workflow<A> => ({ id, effect: bodyToEffect(body) })

const makeLocalCommandExecutor = (
  output: "inherit" | "silent",
): CommandExecutor => ({
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
        if (output === "inherit") process.stdout.write(text)
      } else {
        stderr.push(text)
        if (output === "inherit") process.stderr.write(text)
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

const makeRuntime = (
  workflowId: string,
  ci: boolean,
  mode: WorkflowPlan["mode"],
  emitEvent: (event: RuntimeEvent) => Effect.Effect<void>,
  approvalHandler?: ApprovalHandler,
  commandExecutor: CommandExecutor = makeLocalCommandExecutor("inherit"),
  workspacePersistence: WorkspacePersistence = {
    commit: ({ workspace }) => Effect.succeed(workspace),
    checkpoint: () => Effect.succeed({ provider: "local", value: undefined }),
    restore: ({ checkpoint }) => Effect.succeed(checkpoint.workspace),
  },
) =>
  Effect.gen(function* () {
    const nodes = new Map<string, RuntimeNode>()
    const afterEdges = new Set<string>()
    const edges = new Set<string>()
    const failureOrigins = new Map<unknown, string>()
    const optionalSteps = new Set<string>()
    const parallelSteps = new Set<string>()
    let workflowBarrier: {
      readonly after: ReadonlyArray<string>
      readonly needs: ReadonlyArray<string>
    } = { after: [], needs: [] }
    let runtime!: RuntimeShape

    const cache = yield* Cache.make<string, unknown, unknown, Runtime, "lookup">({
      capacity: 1_000,
      timeToLive: Duration.infinity,
      requireServicesAt: "lookup",
      lookup: (id) => {
        const definition = definitions.get(id)
        if (!definition) return Effect.fail(new Error(`Unknown CI step: ${id}`))

        const node: RuntimeNode = nodes.get(id) ?? {
          id,
          commands: [],
          status: "planned" as const,
        }
        nodes.set(id, node)
        node.status = mode === "plan" ? "planned" : "queued"
        const queued = emitEvent({
          type: "step.status",
          workflowId,
          stepId: id,
          status: node.status,
          optional: optionalSteps.has(id),
          timestamp: new Date().toISOString(),
        })

        return queued.pipe(
          Effect.andThen(definition.body),
          Effect.provideService(CurrentStep, id),
          Effect.flatMap((value) =>
            mode === "execute" && value instanceof Workspace
              ? workspacePersistence.commit({
                  stepId: id,
                  workflowId,
                  workspace: value,
                })
              : Effect.succeed(value)),
          Effect.tap(() => {
            node.status = mode === "plan" ? "planned" : "complete"

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

        return started.pipe(
          Effect.andThen(commandExecutor.execute({
            command,
            onOutput: () => {},
            stepId,
            workflowId,
            workspace,
          })),
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
      },
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
  readonly onEvent?: RuntimeEventHandler
  readonly output?: "inherit" | "silent"
  readonly source?: SourceService
  readonly workspacePersistence?: WorkspacePersistence
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
      ...(node.approval ? { approval: node.approval } : {}),
      optional: runtime.optionalSteps.has(node.id),
      options: definitions.get(node.id)?.options ?? {},
      status: node.status,
    })),
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
    const suffix = `${needs}${after}${optional}`
    const status = node.status === "complete"
      ? "✓"
      : node.status === "warning"
      ? "⚠"
      : node.status === "failed"
      ? "×"
      : node.status === "skipped"
      ? "–"
      : "○"
    lines.push("", `${status} ${node.id}${suffix}`)
    if (plan.mode === "plan") {
      if (node.approval) {
        lines.push(`  approval: ${node.approval.title}`)
      }
      for (const entry of node.commands) {
        lines.push(`  $ ${entry.command}`, `    cwd: ${entry.cwd}`)
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
      emitEvent,
      options.approval,
      options.executor ?? makeLocalCommandExecutor(options.output ?? "inherit"),
      options.workspacePersistence,
    )
    const approval: ApprovalService = {
      request: (request) => Effect.gen(function* () {
        const currentRuntime = yield* Runtime
        const stepId = yield* CurrentStep

        return yield* currentRuntime.requestApproval(stepId, request)
      }),
    }
    const result = yield* workflowDefinition.effect.pipe(
      Effect.provideService(Runtime, runtime),
      Effect.provideService(CurrentStep, "$workflow"),
      Effect.provideService(Source, options.source ?? localSource),
      Effect.provideService(WorkflowEvent, event),
      Effect.provideService(Approval, approval),
      Effect.exit,
    )

    const plan = toPlan(
      workflowDefinition.id,
      runtime,
      environment,
    )
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
      return yield* Effect.failCause(result.cause)
    }

    yield* emitEvent({
      type: "workflow.completed",
      workflowId: workflowDefinition.id,
      conclusion: "success",
      timestamp: new Date().toISOString(),
    })

    return { plan, value: result.value }
  })

export const run = <A>(workflowDefinition: Workflow<A>, options: RunOptions = {}) =>
  interpret(workflowDefinition, options.mode ?? "execute", options).pipe(
    Effect.tap(({ plan }) => options.output === "silent"
      ? Effect.void
      : Effect.sync(() => console.log(`\n${formatPlan(plan)}`))),
  )

export const runPromise = <A>(workflowDefinition: Workflow<A>, options?: RunOptions) =>
  Effect.runPromise(run(workflowDefinition, options))
