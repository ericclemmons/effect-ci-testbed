import { parseArgs } from "node:util"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { detectAgenticEnvironment } from "am-i-vibing"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

export type OutputFormat = "json" | "text"
export type ExecutionLocation = "local" | "remote"

export type ActionTarget = () => Effect.Effect<unknown, unknown, any>

export interface Invocation {
  readonly command: "plan" | "run"
  readonly format: OutputFormat
  readonly location: ExecutionLocation
  readonly target?: string
  readonly workflow: CI.Workflow<unknown>
}

export interface Program {
  readonly actions?: Readonly<Record<string, unknown>>
  readonly local?: CI.RunConfiguration | (() => CI.RunConfiguration)
  readonly remote?: (invocation: Invocation) => Promise<unknown>
  readonly workflow: CI.Workflow<unknown>
}

export const ExitCode = {
  success: 0,
  workflowFailure: 1,
  usage: 2,
  providerUnavailable: 3,
  approval: 4,
} as const

type ExitCode = typeof ExitCode[keyof typeof ExitCode]

class CliFailure extends Error {
  readonly code: string
  readonly exitCode: ExitCode
  readonly details?: unknown

  constructor(
    code: string,
    exitCode: ExitCode,
    message: string,
    details?: unknown,
  ) {
    super(message)
    this.code = code
    this.exitCode = exitCode
    this.details = details
  }
}

const actionTargets = (actions: Program["actions"]): Readonly<Record<string, ActionTarget>> =>
  Object.fromEntries(
    Object.entries(actions ?? {}).filter(
      (entry): entry is [string, ActionTarget] => typeof entry[1] === "function",
    ),
  )

const detectedFormat = (): OutputFormat => {
  try {
    const environment = detectAgenticEnvironment({
      checkProcesses: false,
      processAncestry: [],
    })

    return environment.type === "agent" ? "json" : "text"
  } catch {
    return "text"
  }
}

interface ParsedInvocation {
  readonly command: "list" | "plan" | "run"
  readonly format: OutputFormat
  readonly help: boolean
  readonly location: ExecutionLocation
  readonly target?: string
}

const parseInvocation = (args: ReadonlyArray<string>): ParsedInvocation => {
  let parsed: ReturnType<typeof parseArgs>

  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      options: {
        format: { short: "f", type: "string" },
        help: { short: "h", type: "boolean" },
        local: { type: "boolean" },
        remote: { type: "boolean" },
      },
      strict: true,
    })
  } catch (error) {
    throw new CliFailure(
      "CI_USAGE_ERROR",
      ExitCode.usage,
      error instanceof Error ? error.message : String(error),
    )
  }

  const format = parsed.values.format ?? detectedFormat()

  if (format !== "json" && format !== "text") {
    throw new CliFailure(
      "CI_USAGE_ERROR",
      ExitCode.usage,
      `Unknown output format: ${format}. Expected text or json.`,
    )
  }

  if (parsed.values.local && parsed.values.remote) {
    throw new CliFailure(
      "CI_USAGE_ERROR",
      ExitCode.usage,
      "--local and --remote are mutually exclusive",
    )
  }

  const [first, second, ...rest] = parsed.positionals

  if (rest.length > 0) {
    throw new CliFailure(
      "CI_USAGE_ERROR",
      ExitCode.usage,
      `Unexpected arguments: ${rest.join(" ")}`,
    )
  }

  const command = first === "list" || first === "plan" || first === "run"
    ? first
    : "run"
  const target = command === "run" && first && first !== "run"
    ? first
    : second

  if (command === "list" && target) {
    throw new CliFailure(
      "CI_USAGE_ERROR",
      ExitCode.usage,
      "list does not accept a target",
    )
  }

  return {
    command,
    format,
    help: parsed.values.help === true,
    location: parsed.values.remote ? "remote" : "local",
    ...(target ? { target } : {}),
  }
}

const help = (workflowId: string): string => `Effect CI: ${workflowId}

Usage:
  workflow.ts [run] [target] [--local|--remote] [--format=text|json]
  workflow.ts plan [target] [--local|--remote] [--format=text|json]
  workflow.ts list [--format=text|json]

Commands:
  run     Execute the default workflow or one exported action (default)
  plan    Resolve the graph without executing commands
  list    List the default workflow and exported action targets

Output defaults to JSON for a directly detected coding agent and text otherwise.
An explicit --format always wins.`

const printJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

const defaultLocalOptions = (): CI.RunConfiguration => {
  const event = process.env.EFFECT_CI_EVENT as CI.WorkflowEventName | undefined
  const revision = process.env.EFFECT_CI_REVISION ?? process.env.GITHUB_SHA
  const decision = process.env.EFFECT_CI_APPROVAL
  const approval: CI.ApprovalHandler | undefined = decision === "approved" || decision === "rejected"
    ? { request: () => Effect.succeed({ decision }) }
    : undefined

  return {
    ...(approval ? { approval } : {}),
    env: process.env.NODE_ENV ?? (process.env.CI ? "test" : "development"),
    event: {
      type: event ?? "workflow_dispatch",
      ...(process.env.GITHUB_REF ? { ref: process.env.GITHUB_REF } : {}),
      ...(revision ? { revision } : {}),
    },
  }
}

const classifyFailure = (error: unknown): CliFailure => {
  if (error instanceof CliFailure) return error

  if (error instanceof CI.ApprovalError) {
    return new CliFailure(
      error.decision === "rejected" ? "CI_APPROVAL_REJECTED" : "CI_APPROVAL_UNAVAILABLE",
      ExitCode.approval,
      error.message,
      { decision: error.decision, stepId: error.stepId },
    )
  }

  if (error instanceof CI.CommandError) {
    return new CliFailure(
      "CI_COMMAND_FAILED",
      ExitCode.workflowFailure,
      error.message,
      {
        command: error.command,
        cwd: error.cwd,
        exitCode: error.exitCode,
        stepId: error.stepId,
      },
    )
  }

  if (error instanceof CI.SecretError) {
    return new CliFailure(
      "CI_SECRET_MISSING",
      ExitCode.workflowFailure,
      error.message,
      { name: error.secret },
    )
  }

  if (error instanceof CI.CompensationError) {
    return new CliFailure(
      "CI_COMPENSATION_FAILED",
      ExitCode.workflowFailure,
      error.message,
      { stepId: error.stepId },
    )
  }

  return new CliFailure(
    "CI_WORKFLOW_FAILED",
    ExitCode.workflowFailure,
    error instanceof Error ? error.message : String(error),
  )
}

const selectedWorkflow = (
  program: Program,
  target: string | undefined,
): CI.Workflow<unknown> => {
  if (!target) return program.workflow

  const action = actionTargets(program.actions)[target]

  if (!action) {
    throw new CliFailure(
      "CI_UNKNOWN_TARGET",
      ExitCode.usage,
      `Unknown action target: ${target}`,
      { available: Object.keys(actionTargets(program.actions)).sort() },
    )
  }

  return CI.workflow(`${program.workflow.id}/${target}`, action)
}

const list = (program: Program, format: OutputFormat): void => {
  const targets = Object.keys(actionTargets(program.actions)).sort()

  if (format === "json") {
    printJson({
      schemaVersion: 1,
      ok: true,
      command: "list",
      workflow: program.workflow.id,
      targets,
    })
    return
  }

  console.log(`Workflow: ${program.workflow.id}`)
  console.log("Actions:")
  for (const target of targets) console.log(`  ${target}`)
}

export const main = async (
  program: Program,
  args: ReadonlyArray<string> = process.argv.slice(2),
): Promise<ExitCode> => {
  let format: OutputFormat = detectedFormat()

  try {
    const invocation = parseInvocation(args)
    format = invocation.format

    if (invocation.help) {
      console.log(help(program.workflow.id))
      return ExitCode.success
    }

    if (invocation.command === "list") {
      list(program, format)
      return ExitCode.success
    }

    const workflow = selectedWorkflow(program, invocation.target)
    const request: Invocation = {
      command: invocation.command,
      format,
      location: invocation.location,
      ...(invocation.target ? { target: invocation.target } : {}),
      workflow,
    }

    if (invocation.location === "remote") {
      if (!program.remote) {
        throw new CliFailure(
          "CI_REMOTE_UNAVAILABLE",
          ExitCode.providerUnavailable,
          "This workflow has no remote runner configured",
        )
      }

      const result = await program.remote(request)

      if (format === "json") {
        printJson({
          schemaVersion: 1,
          ok: true,
          command: invocation.command,
          location: invocation.location,
          ...(invocation.target ? { target: invocation.target } : {}),
          workflow: workflow.id,
          result,
        })
      }

      return ExitCode.success
    }

    const configured = typeof program.local === "function"
      ? program.local()
      : program.local ?? defaultLocalOptions()
    const result = await (async () => {
      try {
        return await CI.runPromise(workflow, {
          ...configured,
          mode: invocation.command === "plan" ? "plan" : "execute",
          ...(format === "json"
            ? { output: "silent" as const }
            : configured.output
            ? { output: configured.output }
            : {}),
        })
      } finally {
        await configured.dispose?.()
      }
    })()

    if (format === "json") {
      printJson({
        schemaVersion: 1,
        ok: true,
        command: invocation.command,
        location: invocation.location,
        ...(invocation.target ? { target: invocation.target } : {}),
        workflow: workflow.id,
        plan: result.plan,
      })
    }

    return ExitCode.success
  } catch (error) {
    const failure = classifyFailure(error)

    if (format === "json") {
      printJson({
        schemaVersion: 1,
        ok: false,
        error: {
          code: failure.code,
          message: failure.message,
          ...(failure.details === undefined ? {} : { details: failure.details }),
        },
      })
    } else {
      console.error(`Error [${failure.code}]: ${failure.message}`)
    }

    return failure.exitCode
  }
}

export const runMain = async (program: Program): Promise<void> => {
  process.exitCode = await main(program)
}

export const isMain = (moduleUrl: string): boolean => {
  const entry = process.argv[1]

  return entry !== undefined && pathToFileURL(resolve(entry)).href === moduleUrl
}
