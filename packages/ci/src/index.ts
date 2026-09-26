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

interface PlanNode {
  readonly id: string
  readonly commands: Array<{ command: string; cwd: string }>
  status: "planned" | "running" | "complete" | "failed"
}

interface RuntimeShape {
  readonly dryRun: boolean
  readonly nodes: Map<string, PlanNode>
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

const makeRuntime = (dryRun: boolean) =>
  Effect.gen(function* () {
    const nodes = new Map<string, PlanNode>()
    const edges = new Set<string>()
    let runtime!: RuntimeShape

    const cache = yield* Cache.make<string, unknown, unknown, Runtime, "lookup">({
      capacity: 1_000,
      timeToLive: Duration.infinity,
      requireServicesAt: "lookup",
      lookup: (id) => {
        const definition = definitions.get(id)
        if (!definition) return Effect.fail(new Error(`Unknown CI step: ${id}`))

        const node = nodes.get(id) ?? {
          id,
          commands: [],
          status: "planned" as const,
        }
        nodes.set(id, node)
        node.status = dryRun ? "planned" : "running"

        return definition.body.pipe(
          Effect.provideService(CurrentStep, id),
          Effect.tap(() => Effect.sync(() => {
            node.status = dryRun ? "planned" : "complete"
          })),
          Effect.tapError(() => Effect.sync(() => {
            node.status = "failed"
          })),
        )
      },
    })

    runtime = {
      dryRun,
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

        if (dryRun) {
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
  readonly dryRun?: boolean
  readonly env?: string
}

const printPlan = (workflowId: string, runtime: RuntimeShape, env: string) => {
  const dependencies = new Map<string, Array<string>>()
  for (const edge of runtime.edges) {
    const [parent, child] = edge.split("->") as [string, string]
    const children = dependencies.get(parent) ?? []
    children.push(child)
    dependencies.set(parent, children)
  }

  const ordered: Array<PlanNode> = []
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    for (const dependency of dependencies.get(id) ?? []) visit(dependency)
    const node = runtime.nodes.get(id)
    if (node) ordered.push(node)
  }
  for (const id of runtime.nodes.keys()) visit(id)

  console.log(`\nCI ${runtime.dryRun ? "dry run" : "run"}: ${workflowId}`)
  console.log(`Environment: ${env}`)

  for (const node of ordered) {
    const needs = dependencies.get(node.id) ?? []
    const suffix = needs.length > 0 ? ` needs ${needs.join(", ")}` : ""
    console.log(`\n${node.status === "complete" ? "✓" : "○"} ${node.id}${suffix}`)
    for (const entry of node.commands) {
      console.log(`  $ ${entry.command}`)
      console.log(`    cwd: ${entry.cwd}`)
    }
  }
}

export const run = <A>(workflowDefinition: Workflow<A>, options: RunOptions = {}) =>
  Effect.gen(function* () {
    const runtime = yield* makeRuntime(options.dryRun ?? false)
    const result = yield* workflowDefinition.effect.pipe(
      Effect.provideService(Runtime, runtime),
      Effect.provideService(CurrentStep, "$workflow"),
      Effect.exit,
    )

    printPlan(workflowDefinition.id, runtime, options.env ?? "development")

    if (Exit.isFailure(result)) {
      return yield* Effect.failCause(result.cause)
    }

    return result.value
  })

export const runPromise = <A>(workflowDefinition: Workflow<A>, options?: RunOptions) =>
  Effect.runPromise(run(workflowDefinition, options))
