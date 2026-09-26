import { spawn } from "node:child_process"
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

type StepBody<A> =
  | Effect.Effect<A, any, any>
  | (() =>
      | Generator<any, A, any>
      | Effect.Effect<A, any, any>
      | Promise<A>)

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
  readonly options: StepOptions
  readonly status: "planned" | "running" | "complete" | "failed"
}

export interface WorkflowPlan {
  readonly workflowId: string
  readonly environment: string
  readonly mode: "plan" | "execute"
  readonly nodes: ReadonlyArray<PlanNode>
}

interface RuntimeNode {
  readonly id: string
  readonly commands: Array<PlannedCommand>
  status: PlanNode["status"]
}

interface RuntimeShape {
  readonly mode: WorkflowPlan["mode"]
  readonly nodes: Map<string, RuntimeNode>
  readonly edges: Set<string>
  readonly cache: Cache.Cache<string, unknown, unknown, Runtime>
  readonly addDependency: (parent: string, child: string) => Effect.Effect<void>
  readonly execute: (
    stepId: string,
    workspace: Workspace,
    command: string,
  ) => Effect.Effect<Workspace, CommandError>
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
    readonly command: string,
    readonly cwd: string,
    readonly exitCode: number,
  ) {
    super(`Command failed (${exitCode}): ${command}`)
  }
}

export class Workspace {
  private constructor(
    readonly cwd: string,
    readonly lineage: ReadonlyArray<string>,
  ) {}

  static local(cwd: string): Workspace {
    return new Workspace(cwd, [])
  }

  exec(command: string): Effect.Effect<Workspace, CommandError, Runtime | CurrentStep> {
    const workspace = this
    return Effect.gen(function* () {
      const runtime = yield* Runtime
      const stepId = yield* CurrentStep
      return yield* runtime.execute(stepId, workspace, command)
    })
  }

  completed(stepId: string): Workspace {
    return new Workspace(this.cwd, [...this.lineage, stepId])
  }
}

export interface Workflow<A> {
  readonly id: string
  readonly effect: Effect.Effect<A, unknown, Runtime | CurrentStep>
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

    return Effect.tryPromise({
      try: () => result as Promise<A>,
      catch: (error) => error,
    })
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

  return Effect.gen(function* () {
    const runtime = yield* Runtime
    const parent = yield* CurrentStep
    yield* runtime.addDependency(parent, id)
    return (yield* Cache.get(runtime.cache, id)) as A
  })
}

export const workflow = <A>(
  id: string,
  effect: Effect.Effect<A, unknown, Runtime | CurrentStep>,
): Workflow<A> => ({ id, effect })

const runCommand = (
  command: string,
  cwd: string,
): Effect.Effect<void, CommandError> =>
  Effect.callback<void, CommandError>((resume) => {
    const child = spawn(command, {
      cwd,
      env: process.env,
      shell: true,
      stdio: "inherit",
    })

    child.once("error", () => resume(Effect.fail(new CommandError(command, cwd, 1))))
    child.once("exit", (code) => {
      resume(code === 0 ? Effect.void : Effect.fail(new CommandError(command, cwd, code ?? 1)))
    })

    return Effect.sync(() => child.kill("SIGTERM"))
  })

const makeRuntime = (mode: WorkflowPlan["mode"]) =>
  Effect.gen(function* () {
    const nodes = new Map<string, RuntimeNode>()
    const edges = new Set<string>()
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
        node.status = mode === "plan" ? "planned" : "running"

        return definition.body.pipe(
          Effect.provideService(CurrentStep, id),
          Effect.tap(() => Effect.sync(() => {
            node.status = mode === "plan" ? "planned" : "complete"
          })),
          Effect.tapError(() => Effect.sync(() => {
            node.status = "failed"
          })),
        )
      },
    })

    runtime = {
      mode,
      nodes,
      edges,
      cache,
      addDependency: (parent, child) => Effect.sync(() => {
        if (parent !== "$workflow") edges.add(`${parent}->${child}`)
      }),
      execute: (stepId, workspace, command) => {
        const node = nodes.get(stepId)
        if (!node) return Effect.die(new Error(`Missing plan node for ${stepId}`))

        node.commands.push({ command, cwd: workspace.cwd })

        if (mode === "plan") {
          return Effect.succeed(workspace.completed(stepId))
        }

        return runCommand(command, workspace.cwd).pipe(
          Effect.as(workspace.completed(stepId)),
        )
      },
    }

    return runtime
  })

export interface RunOptions {
  readonly env?: string
  readonly mode?: WorkflowPlan["mode"]
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
      options: definitions.get(node.id)?.options ?? {},
      status: node.status,
    })),
  }
}

export const formatPlan = (plan: WorkflowPlan): string => {
  const lines = [
    `CI ${plan.mode === "plan" ? "dry run" : "run"}: ${plan.workflowId}`,
    `Environment: ${plan.environment}`,
  ]

  for (const node of plan.nodes) {
    const suffix = node.needs.length > 0 ? ` needs ${node.needs.join(", ")}` : ""
    lines.push("", `${node.status === "complete" ? "✓" : "○"} ${node.id}${suffix}`)
    for (const entry of node.commands) {
      lines.push(`  $ ${entry.command}`, `    cwd: ${entry.cwd}`)
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
    const runtime = yield* makeRuntime(mode)
    const result = yield* workflowDefinition.effect.pipe(
      Effect.provideService(Runtime, runtime),
      Effect.provideService(CurrentStep, "$workflow"),
      Effect.exit,
    )

    const plan = toPlan(
      workflowDefinition.id,
      runtime,
      options.env ?? "development",
    )

    if (Exit.isFailure(result)) {
      return yield* Effect.failCause(result.cause)
    }

    return { plan, value: result.value }
  })

export const run = <A>(workflowDefinition: Workflow<A>, options: RunOptions = {}) =>
  interpret(workflowDefinition, options.mode ?? "execute", options).pipe(
    Effect.tap(({ plan }) => Effect.sync(() => console.log(`\n${formatPlan(plan)}`))),
  )

export const runPromise = <A>(workflowDefinition: Workflow<A>, options?: RunOptions) =>
  Effect.runPromise(run(workflowDefinition, options))
