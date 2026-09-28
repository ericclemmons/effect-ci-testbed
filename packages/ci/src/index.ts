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
  readonly needs: ReadonlyArray<string>
  readonly commands: ReadonlyArray<PlannedCommand>
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
  status: PlanNode["status"]
}

interface RuntimeShape {
  readonly workflowId: string
  readonly mode: WorkflowPlan["mode"]
  readonly nodes: Map<string, RuntimeNode>
  readonly edges: Set<string>
  readonly optionalSteps: Set<string>
  readonly cache: Cache.Cache<string, unknown, unknown, Runtime>
  readonly addDependency: (parent: string, child: string) => Effect.Effect<void>
  readonly markOptional: (stepId: string) => Effect.Effect<void>
  readonly recoverOptional: (stepId: string) => Effect.Effect<boolean>
  readonly execute: (
    stepId: string,
    workspace: Workspace,
    command: string,
  ) => Effect.Effect<Workspace, CommandError>
}

const eventFileDescriptor = Number(process.env.EFFECT_CI_EVENT_FD)

const emitEvent = (event: RuntimeEvent): void => {
  if (!Number.isInteger(eventFileDescriptor)) return
  writeSync(eventFileDescriptor, `${JSON.stringify(event)}\n`)
}

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

export class Workspace {
  private constructor(readonly cwd: string) {}

  static local(cwd: string): Workspace {
    return new Workspace(cwd)
  }

  exec(command: string): Effect.Effect<Workspace, CommandError, Runtime | CurrentStep> {
    const workspace = this
    return Effect.gen(function* () {
      const runtime = yield* Runtime
      const stepId = yield* CurrentStep
      return yield* runtime.execute(stepId, workspace, command)
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
          options: InstallOptions = {},
        ) => {
          switch (operation) {
            case "install":
              if (!options.frozenLockfile) return `${name} install`
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
          install: (options) => workspace.exec(command("install", undefined, options)),
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

export interface Workflow<A> {
  readonly id: string
  readonly effect: Effect.Effect<A, unknown, Runtime | CurrentStep | WorkflowEvent>
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

export const optional = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A | undefined, E, R | Runtime> => {
  const stepId = actionIds.get(effect as object)
  if (!stepId) throw new Error("CI.optional expects a CI action or step")

  return Effect.gen(function* () {
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
}

export const parallel = <Effects extends ReadonlyArray<Effect.Effect<any, any, any>>>(
  effects: Effects,
) => Effect.validate(
  effects,
  (effect) => effect,
  { concurrency: "unbounded", discard: true },
)

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

export const action = <A, Args extends ReadonlyArray<unknown> = ReadonlyArray<never>>(
  id: string,
  construction: ActionConstruction<Args, A>,
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

const runCommand = (
  workflowId: string,
  stepId: string,
  command: string,
  cwd: string,
): Effect.Effect<void, CommandError> =>
  Effect.callback<void, CommandError>((resume) => {
    const child = spawn(command, {
      cwd,
      env: process.env,
      shell: true,
      stdio: ["inherit", "pipe", "pipe"],
    })

    const forward = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString()
      if (stream === "stdout") process.stdout.write(text)
      else process.stderr.write(text)
      emitEvent({
        type: "step.output",
        workflowId,
        stepId,
        stream,
        text,
        timestamp: new Date().toISOString(),
      })
    }

    child.stdout?.on("data", (chunk: Buffer) => forward("stdout", chunk))
    child.stderr?.on("data", (chunk: Buffer) => forward("stderr", chunk))

    child.once("error", () => resume(Effect.fail(new CommandError(stepId, command, cwd, 1))))
    child.once("close", (code) => {
      resume(code === 0 ? Effect.void : Effect.fail(new CommandError(stepId, command, cwd, code ?? 1)))
    })

    return Effect.sync(() => child.kill("SIGTERM"))
  })

const makeRuntime = (workflowId: string, mode: WorkflowPlan["mode"]) =>
  Effect.gen(function* () {
    const nodes = new Map<string, RuntimeNode>()
    const edges = new Set<string>()
    const failureOrigins = new Map<unknown, string>()
    const optionalSteps = new Set<string>()
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
        emitEvent({
          type: "step.status",
          workflowId,
          stepId: id,
          status: node.status,
          optional: optionalSteps.has(id),
          timestamp: new Date().toISOString(),
        })

        return definition.body.pipe(
          Effect.provideService(CurrentStep, id),
          Effect.tap(() => Effect.sync(() => {
            node.status = mode === "plan" ? "planned" : "complete"
            emitEvent({
              type: "step.status",
              workflowId,
              stepId: id,
              status: node.status,
              optional: optionalSteps.has(id),
              timestamp: new Date().toISOString(),
            })
          })),
          Effect.tapError((error) => Effect.sync(() => {
            const origin = failureOrigins.get(error)
            node.status = origin && origin !== id ? "skipped" : "failed"
            if (!origin) failureOrigins.set(error, id)
            emitEvent({
              type: "step.status",
              workflowId,
              stepId: id,
              status: node.status,
              optional: optionalSteps.has(id),
              timestamp: new Date().toISOString(),
            })
          })),
        )
      },
    })

    runtime = {
      workflowId,
      mode,
      nodes,
      edges,
      optionalSteps,
      cache,
      addDependency: (parent, child) => Effect.sync(() => {
        if (parent !== "$workflow") {
          edges.add(`${parent}->${child}`)
          emitEvent({
            type: "dependency.added",
            workflowId,
            stepId: parent,
            needs: child,
            timestamp: new Date().toISOString(),
          })
        }
      }),
      markOptional: (stepId) => Effect.sync(() => {
        optionalSteps.add(stepId)
      }),
      recoverOptional: (stepId) => Effect.sync(() => {
        const node = nodes.get(stepId)
        if (!node || node.status !== "failed") return false
        node.status = "warning"
        emitEvent({
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

        if (node.status !== "running") {
          node.status = "running"
          emitEvent({
            type: "step.status",
            workflowId,
            stepId,
            status: "running",
            optional: optionalSteps.has(stepId),
            timestamp: new Date().toISOString(),
          })
        }

        return runCommand(workflowId, stepId, command, workspace.cwd).pipe(
          Effect.as(workspace),
        )
      },
    }

    return runtime
  })

export interface RunOptions {
  readonly env?: string
  readonly event?: WorkflowEventShape
  readonly mode?: WorkflowPlan["mode"]
  readonly source?: SourceService
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

  const ordered: Array<RuntimeNode> = []
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    for (const dependency of [...(dependencies.get(id) ?? [])].sort()) visit(dependency)
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
      needs: [...(dependencies.get(node.id) ?? [])].sort(),
      commands: [...node.commands],
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
    const needs = node.needs.length > 0 ? ` needs ${node.needs.join(", ")}` : ""
    const optional = node.optional ? " (optional)" : ""
    const suffix = `${needs}${optional}`
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
    emitEvent({
      type: "workflow.started",
      workflowId: workflowDefinition.id,
      environment,
      mode,
      timestamp: new Date().toISOString(),
    })

    const runtime = yield* makeRuntime(workflowDefinition.id, mode)
    const result = yield* workflowDefinition.effect.pipe(
      Effect.provideService(Runtime, runtime),
      Effect.provideService(CurrentStep, "$workflow"),
      Effect.provideService(Source, options.source ?? localSource),
      Effect.provideService(WorkflowEvent, event),
      Effect.exit,
    )

    const plan = toPlan(
      workflowDefinition.id,
      runtime,
      environment,
    )
    emitEvent({
      type: "workflow.plan",
      workflowId: workflowDefinition.id,
      plan,
      timestamp: new Date().toISOString(),
    })

    if (Exit.isFailure(result)) {
      emitEvent({
        type: "workflow.completed",
        workflowId: workflowDefinition.id,
        conclusion: "failure",
        timestamp: new Date().toISOString(),
      })
      return yield* Effect.failCause(result.cause)
    }

    emitEvent({
      type: "workflow.completed",
      workflowId: workflowDefinition.id,
      conclusion: "success",
      timestamp: new Date().toISOString(),
    })

    return { plan, value: result.value }
  })

export const run = <A>(workflowDefinition: Workflow<A>, options: RunOptions = {}) =>
  interpret(workflowDefinition, options.mode ?? "execute", options).pipe(
    Effect.tap(({ plan }) => Effect.sync(() => console.log(`\n${formatPlan(plan)}`))),
  )

export const runPromise = <A>(workflowDefinition: Workflow<A>, options?: RunOptions) =>
  Effect.runPromise(run(workflowDefinition, options))
