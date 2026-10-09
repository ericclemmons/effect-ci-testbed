import { existsSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { basename, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { detectAgenticEnvironment } from "am-i-vibing"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { remoteEventUrl, remoteOrigin, remoteRecords } from "./remote-protocol.ts"

export type OutputFormat = "json" | "mermaid" | "text"
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
  readonly local?: CI.RunConfiguration | ((context: LocalContext) => CI.RunConfiguration)
  readonly remote?: (invocation: Invocation) => Promise<unknown>
  readonly workflow: CI.Workflow<unknown>
}

export interface LocalContext {
  readonly root: string
  readonly workflowPath: string
}

export interface LoadedProgram {
  readonly args: ReadonlyArray<string>
  readonly path: string
  readonly program: Program
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
      (entry): entry is [string, ActionTarget] => CI.isAction(entry[1]),
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

interface RemoteRunResponse {
  readonly instanceId: string
  readonly eventsUrl: string
  readonly statusUrl: string
}

interface WorkflowInstanceEvent {
  readonly type: string
  readonly eventId?: number
  readonly stepName?: string
  readonly attempt?: number
  readonly error?: { readonly message?: string }
  readonly output?: unknown
}

const remoteHeaders = (): Headers => {
  const headers = new Headers({ "content-type": "application/json" })

  if (process.env.EFFECT_CI_REMOTE_TOKEN) {
    headers.set("authorization", `Bearer ${process.env.EFFECT_CI_REMOTE_TOKEN}`)
  }

  if (process.env.CF_ACCESS_TOKEN) {
    headers.set("cf-access-token", process.env.CF_ACCESS_TOKEN)
  } else if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    headers.set("cf-access-client-id", process.env.CF_ACCESS_CLIENT_ID)
    headers.set("cf-access-client-secret", process.env.CF_ACCESS_CLIENT_SECRET)
  }

  return headers
}

const git = (root: string, ...args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()

const gitOptional = (root: string, ...args: ReadonlyArray<string>): string | undefined => {
  try {
    return git(root, ...args)
  } catch {
    return undefined
  }
}

const cloneUrl = (value: string): string => {
  const githubSsh = value.match(/^git@github\.com:(.+)$/)

  return githubSsh ? `https://github.com/${githubSsh[1]}` : value
}

const describeEvent = (event: WorkflowInstanceEvent): string => {
  switch (event.type) {
    case "step_started": return `→ ${event.stepName}`
    case "step_completed": {
      let value = event.output
      if (typeof value === "string") {
        try { value = JSON.parse(value) } catch { /* A non-command step may return plain text. */ }
      }
      const output = value && typeof value === "object"
        ? value as Record<string, unknown>
        : undefined
      const stdout = typeof output?.stdout === "string" ? output.stdout.trimEnd() : ""
      const stderr = typeof output?.stderr === "string" ? output.stderr.trimEnd() : ""
      const logs = [stdout, stderr].filter(Boolean).join("\n")

      return `✓ ${event.stepName}${logs ? `\n${logs}` : ""}`
    }
    case "step_errored": return `✗ ${event.stepName}`
    case "attempt_errored": return `↻ ${event.stepName} attempt ${event.attempt} failed${event.error?.message ? `: ${event.error.message}` : ""}`
    case "wait_started": return `… ${event.stepName}`
    case "workflow_completed": return "✓ Workflow completed"
    case "workflow_errored": return `✗ Workflow failed${event.error?.message ? `: ${event.error.message}` : ""}`
    case "workflow_terminated": return "✗ Workflow terminated"
    default: return event.type
  }
}

const streamRemoteEvents = async (
  response: Response,
  format: OutputFormat,
): Promise<ReadonlyArray<WorkflowInstanceEvent>> => {
  if (!response.ok || !response.body) {
    throw new CliFailure(
      "CI_REMOTE_FAILED",
      ExitCode.providerUnavailable,
      `Could not follow the remote run (${response.status}): ${await response.text()}`,
    )
  }

  const events: WorkflowInstanceEvent[] = []
  for await (const record of remoteRecords(response.body)) {
    const event = record as WorkflowInstanceEvent
    events.push(event)
    if (format === "text") console.log(describeEvent(event))
    if (["workflow_completed", "workflow_errored", "workflow_terminated"].includes(event.type)) break
  }

  return events
}

const builtInRemote = async (
  invocation: Invocation,
  root: string,
): Promise<unknown> => {
  const configuredUrl = process.env.EFFECT_CI_REMOTE_URL
  const remoteUrl = configuredUrl ? remoteOrigin(configuredUrl) : undefined

  if (!remoteUrl) {
    throw new CliFailure(
      "CI_REMOTE_UNAVAILABLE",
      ExitCode.providerUnavailable,
      "Set EFFECT_CI_REMOTE_URL or export a custom remote runner from the workflow module",
    )
  }

  if (invocation.target) {
    throw new CliFailure(
      "CI_REMOTE_TARGET_UNAVAILABLE",
      ExitCode.providerUnavailable,
      "The hosted runner currently executes the workflow suite, not individual exported actions",
    )
  }

  if (invocation.command !== "run") {
    throw new CliFailure(
      "CI_REMOTE_COMMAND_UNAVAILABLE",
      ExitCode.providerUnavailable,
      "The built-in hosted runner supports `run --remote`; plan locally before dispatching",
    )
  }

  const repository = cloneUrl(git(root, "config", "--get", "remote.origin.url"))
  if (git(root, "status", "--porcelain", "--untracked-files=normal")) {
    throw new CliFailure(
      "CI_REMOTE_DIRTY_WORKTREE",
      ExitCode.usage,
      "Remote execution checks the pushed commit, not local edits. Run locally or commit and push the changes first.",
    )
  }
  const revision = git(root, "rev-parse", "HEAD")
  const ref = gitOptional(root, "symbolic-ref", "--quiet", "HEAD")
  const response = await fetch(`${remoteUrl}/runs`, {
    method: "POST",
    redirect: "error",
    headers: remoteHeaders(),
    body: JSON.stringify({ repository, revision, ...(ref ? { ref } : {}) }),
  })

  if (!response.ok) {
    throw new CliFailure(
      "CI_REMOTE_FAILED",
      ExitCode.providerUnavailable,
      `Could not start the remote run (${response.status}): ${await response.text()}`,
    )
  }

  const run = await response.json() as RemoteRunResponse

  if (invocation.format === "text") console.log(`Remote Workflow ${run.instanceId}`)

  const events = await streamRemoteEvents(await fetch(remoteEventUrl(remoteUrl, run.eventsUrl), {
    headers: remoteHeaders(),
    redirect: "error",
  }), invocation.format)
  const terminal = events.at(-1)

  if (terminal?.type === "workflow_errored" || terminal?.type === "workflow_terminated") {
    throw new CliFailure(
      "CI_WORKFLOW_FAILED",
      ExitCode.workflowFailure,
      describeEvent(terminal),
      { instanceId: run.instanceId, events },
    )
  }

  if (terminal?.type !== "workflow_completed") {
    throw new CliFailure(
      "CI_REMOTE_STREAM_ENDED",
      ExitCode.providerUnavailable,
      "The remote event stream ended before the Workflow reported a terminal result",
      { instanceId: run.instanceId, events },
    )
  }

  return { ...run, events }
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

  if (format !== "json" && format !== "mermaid" && format !== "text") {
    throw new CliFailure(
      "CI_USAGE_ERROR",
      ExitCode.usage,
      `Unknown output format: ${format}. Expected text, json, or mermaid.`,
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
  cf-ci [run] [target] [--local|--remote] [--format=text|json]
  cf-ci plan [target] [--local|--remote] [--format=text|json|mermaid]
  cf-ci list [--format=text|json]
  cf-ci run path/to/workflow.ts [target]
  cf-ci --workflow path/to/workflow.ts [run|plan|list] [target]

Commands:
  run     Execute the default workflow or one exported action (default)
  plan    Resolve the graph without executing commands
  list    List the default workflow and exported action targets

Without an explicit path, cf-ci finds .cloudflare/ci/workflow.ts from the current
directory or one of its parents.
Output defaults to JSON for a directly detected coding agent and text otherwise.
An explicit --format always wins.`

const workflowNames = [
  "workflow.ts",
  "workflow.mts",
  "workflow.js",
  "workflow.mjs",
  "ci.ts",
  "ci.mts",
  "ci.js",
  "ci.mjs",
] as const
const findWorkflow = (cwd: string): string | undefined => {
  let directory = resolve(cwd)

  while (true) {
    for (const name of workflowNames) {
      const candidate = join(directory, ".cloudflare", "ci", name)
      if (existsSync(candidate)) return candidate
    }

    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

const looksLikeWorkflowPath = (value: string): boolean =>
  value.includes("/") || value.includes("\\") || /\.(?:[cm]?[jt]s)$/.test(value)

const extractWorkflow = (
  args: ReadonlyArray<string>,
  cwd: string,
): { readonly args: ReadonlyArray<string>; readonly path: string } => {
  const remaining = [...args]
  let explicit: string | undefined

  for (let index = 0; index < remaining.length; index += 1) {
    const argument = remaining[index]

    if (argument === "--workflow") {
      explicit = remaining[index + 1]
      if (!explicit) {
        throw new CliFailure(
          "CI_USAGE_ERROR",
          ExitCode.usage,
          "--workflow requires a path",
        )
      }
      remaining.splice(index, 2)
      break
    }

    if (argument?.startsWith("--workflow=")) {
      explicit = argument.slice("--workflow=".length)
      remaining.splice(index, 1)
      break
    }
  }

  if (!explicit) {
    const positional = remaining.findIndex((argument, index) =>
      argument !== undefined &&
      !argument.startsWith("-") &&
      !(index === 0 && ["list", "plan", "run"].includes(argument)) &&
      looksLikeWorkflowPath(argument)
    )

    if (positional >= 0) {
      explicit = remaining[positional]
      remaining.splice(positional, 1)
    }
  }

  const path = explicit ? resolve(cwd, explicit) : findWorkflow(cwd)

  if (!path || !existsSync(path)) {
    throw new CliFailure(
      "CI_WORKFLOW_NOT_FOUND",
      ExitCode.usage,
      explicit
        ? `Workflow not found: ${resolve(cwd, explicit)}`
        : `No .cloudflare/ci/workflow.ts found from ${resolve(cwd)}`,
    )
  }

  return { args: remaining, path }
}

export const loadProgram = async (
  args: ReadonlyArray<string> = process.argv.slice(2),
  cwd: string = process.cwd(),
): Promise<LoadedProgram> => {
  const selected = extractWorkflow(args, cwd)
  const module = await import(pathToFileURL(selected.path).href) as Readonly<Record<string, unknown>> & {
    readonly default?: CI.Workflow<unknown>
    readonly local?: CI.RunConfiguration | ((context: LocalContext) => CI.RunConfiguration)
    readonly remote?: Program["remote"]
  }

  if (!module.default && basename(selected.path).startsWith("ci.")) {
    return {
      args: selected.args,
      path: selected.path,
      program: inferJavaScriptProgram(projectRoot(selected.path)),
    }
  }

  if (!module.default) {
    throw new CliFailure(
      "CI_WORKFLOW_INVALID",
      ExitCode.usage,
      `${selected.path} must default-export a CI workflow`,
    )
  }

  return {
    args: selected.args,
    path: selected.path,
    program: {
      actions: module,
      ...(module.local ? { local: module.local } : {}),
      ...(module.remote ? { remote: module.remote } : {}),
      workflow: module.default,
    },
  }
}

const inferredScriptOrder = [
  "format",
  "lint",
  "check",
  "typecheck",
  "test",
  "build",
] as const

const inferJavaScriptProgram = (root: string): Program => {
  const manifestPath = join(root, "package.json")

  if (!existsSync(manifestPath)) {
    throw new CliFailure(
      "CI_ZERO_CONFIG_UNSUPPORTED",
      ExitCode.usage,
      `Zero-config CI requires a package.json at ${manifestPath}`,
    )
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    readonly name?: string
    readonly scripts?: Readonly<Record<string, string>>
  }
  const names = inferredScriptOrder.filter((name) => manifest.scripts?.[name])

  if (names.length === 0) {
    throw new CliFailure(
      "CI_ZERO_CONFIG_NO_TASKS",
      ExitCode.usage,
      "Zero-config CI found no format, lint, check, typecheck, test, or build scripts",
    )
  }

  const checkout = CI.action("checkout", function* () {
    const source = yield* CI.Source

    return () => source.checkout()
  })
  const install = CI.action("install", () => function* () {
    const workspace = yield* checkout()
    const packageManager = yield* CI.PackageManager.JavaScript(workspace)

    return yield* packageManager.install()
  })
  const actions = Object.fromEntries(names.map((name) => [
    name,
    CI.action(name, () => function* () {
      const workspace = yield* install()
      const packageManager = yield* CI.PackageManager.JavaScript(workspace)

      return yield* packageManager.run(name)
    }),
  ])) as Readonly<Record<string, ActionTarget>>

  return {
    actions,
    workflow: CI.workflow(manifest.name ?? "ci", function* () {
      let workspace: unknown

      for (const name of names) {
        workspace = yield* actions[name]!()
      }

      return workspace
    }),
  }
}

const printJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

const projectRoot = (workflowPath: string): string =>
  basename(dirname(workflowPath)) === "ci" && basename(dirname(dirname(workflowPath))) === ".cloudflare"
    ? resolve(dirname(workflowPath), "../..")
    : dirname(workflowPath)

const defaultLocalOptions = (workflowPath: string): CI.RunConfiguration => {
  const event = process.env.EFFECT_CI_EVENT as CI.WorkflowEventName | undefined
  const revision = process.env.EFFECT_CI_REVISION ?? process.env.GITHUB_SHA
  const repository = process.env.GITHUB_REPOSITORY
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
      ...(repository && revision
        ? {
            source: {
              kind: "git",
              repository: `https://github.com/${repository}.git`,
              revision,
            },
          }
        : {}),
    },
    source: {
      checkout: () => Effect.succeed(CI.Workspace.local(projectRoot(workflowPath))),
      reference: { kind: "local", path: projectRoot(workflowPath) },
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

  if (error instanceof CI.RollbackError) {
    return new CliFailure(
      "CI_ROLLBACK_FAILED",
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
  workflowPath: string = resolve(process.cwd(), ".cloudflare/ci/workflow.ts"),
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
      if (format === "mermaid") {
        throw new CliFailure(
          "CI_USAGE_ERROR",
          ExitCode.usage,
          "Mermaid output is available for plan, not list",
        )
      }
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
      const result = program.remote
        ? await program.remote(request)
        : await builtInRemote(request, projectRoot(workflowPath))

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

    const defaults = defaultLocalOptions(workflowPath)
    const overrides = typeof program.local === "function"
      ? program.local({ root: projectRoot(workflowPath), workflowPath })
      : program.local ?? {}
    const configured: CI.RunConfiguration = { ...defaults, ...overrides }
    const result = await (async () => {
      try {
        return await CI.runPromise(workflow, {
          ...configured,
          mode: invocation.command === "plan" ? "plan" : "execute",
          ...(format === "json" || format === "mermaid"
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
    } else if (format === "mermaid") {
      console.log(CI.formatPlanMermaid(result.plan))
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

export const runCli = async (
  args: ReadonlyArray<string> = process.argv.slice(2),
  cwd: string = process.cwd(),
): Promise<void> => {
  try {
    const loaded = await loadProgram(args, cwd)
    process.exitCode = await main(loaded.program, loaded.args, loaded.path)
  } catch (error) {
    const failure = classifyFailure(error)
    console.error(`Error [${failure.code}]: ${failure.message}`)
    process.exitCode = failure.exitCode
  }
}
