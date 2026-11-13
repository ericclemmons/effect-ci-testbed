import * as Effect from "effect/Effect"
import { MinimumLogLevel } from "effect/References"
import * as CI from "./index.ts"

/** The parts of a `vp run --dry-run --json` run plan (version 1, Vite+ 1.6) that the log uses. */
interface RunPlanStep {
  readonly plan?: RunPlan["plan"]
  readonly cache?: {
    readonly status: "hit" | "changed" | "unknown" | "noBaseline" | "error" | "disabled"
    readonly baseline?: {
      readonly durationMs: number
      readonly fingerprint?: { readonly env?: ReadonlyArray<string>; readonly inputs?: Readonly<Record<string, { readonly type: string }>> }
      readonly outputs?: ReadonlyArray<string> | "notDownloaded"
    }
    readonly changes?: ReadonlyArray<
      | { readonly kind: "program" | "args" | "cwd" }
      | { readonly kind: "config"; readonly setting: string }
      | { readonly kind: "env"; readonly name: string; readonly change: string }
      | { readonly kind: "file"; readonly path: string; readonly change: string }
    >
    readonly changesPartial?: true
    readonly message?: string
  }
}

interface RunPlan {
  readonly version: number
  readonly plan: Readonly<Record<string, { readonly steps: ReadonlyArray<RunPlanStep> }>>
}

export interface CacheLogLine {
  readonly level: "Info" | "Debug"
  readonly message: string
}

type Change = NonNullable<NonNullable<RunPlanStep["cache"]>["changes"]>[number]

// Diff-style markers: + added, - removed, ± changed.
const marker = (change: string) => change === "added" ? "+" : change === "removed" ? "-" : "±"

const describeChange = (change: Change): string => {
  switch (change.kind) {
    case "file": return `${marker(change.change)} ${change.path}`
    case "env": return `${marker(change.change)} env ${change.name}`
    case "config": return `± config ${change.setting}`
    default: return `± ${change.kind}`
  }
}

const describeStatus = (cache: RunPlanStep["cache"]): string => {
  switch (cache?.status) {
    case undefined: return ": not a cached command"
    case "hit": return `: cached${cache.baseline ? ` (${cache.baseline.durationMs}ms saved)` : ""}`
    case "changed": return " changes:"
    case "unknown": return " changes, before an earlier step writes files:"
    case "noBaseline": return ": no cached run yet"
    case "disabled": return ": caching off"
    case "error": return `: cache error: ${cache.message ?? "unreadable"}`
  }
}

/**
 * Turns a Vite+ run plan into log lines: each step's cache status and every change at Info,
 * and, from a `-vv` plan, the inputs and outputs of the cached run at Debug.
 */
export const cacheLog = (body: string): CacheLogLine[] => {
  const plan = JSON.parse(body) as RunPlan
  if (plan.version !== 1 || typeof plan.plan !== "object" || plan.plan === null) {
    throw new Error("Expected a version 1 Vite+ run plan from `vp run --dry-run --json`")
  }
  const lines: CacheLogLine[] = []
  const visit = (tasks: RunPlan["plan"], prefix: string) => {
    for (const [id, task] of Object.entries(tasks)) {
      task.steps.forEach((step, index) => {
        const label = `${prefix}${id}${task.steps.length === 1 ? "" : ` step ${index + 1}`}`
        if (step.plan) return visit(step.plan, `${label} › `)
        const cache = step.cache
        lines.push({ level: "Info", message: `vite+ ${label}${describeStatus(cache)}` })
        for (const change of cache?.changes ?? []) lines.push({ level: "Info", message: `  ${describeChange(change)}` })
        if (cache?.changesPartial) lines.push({ level: "Info", message: "  and maybe more" })
        for (const name of cache?.baseline?.fingerprint?.env ?? []) lines.push({ level: "Debug", message: `  input env ${name}` })
        for (const [path, input] of Object.entries(cache?.baseline?.fingerprint?.inputs ?? {})) {
          lines.push({ level: "Debug", message: `  input ${path}${input.type === "file" ? "" : ` (${input.type})`}` })
        }
        const outputs = cache?.baseline?.outputs
        if (outputs === "notDownloaded") lines.push({ level: "Debug", message: "  outputs not downloaded" })
        else for (const path of outputs ?? []) lines.push({ level: "Debug", message: `  output ${path}` })
      })
    }
  }
  visit(plan.plan, "")
  return lines
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

// Prefer the global vp; fall back to the project's own when a runner has none.
const vp = `PATH="$PATH:$PWD/node_modules/.bin" vp`

/** Vite+ in a project, through the global `vp` CLI. */
export const VitePlus = (workspace: CI.Workspace) => Effect.succeed({
  workspace,
  /**
   * Runs a Vite+ task with `vp run -v`. A dry run first logs whether each step would hit the
   * cache, and every change behind a miss; at Debug, also the cached run's inputs and outputs.
   */
  run: (task: string) => Effect.gen(function* () {
    if ((yield* CI.executionMode) === "execute") {
      const level = yield* MinimumLogLevel
      const verbose = level === "Debug" || level === "Trace" || level === "All" ? "-vv" : "-v"
      // In node_modules, so the plan is never an input of the task it describes.
      const file = "node_modules/.effect-ci-vite-plus-run-plan.json"
      yield* workspace.exec(`${vp} run --dry-run --json ${verbose} ${quote(task)} > ${file}`)
      const body = yield* workspace.readFile(file)
      if (body === undefined) return yield* Effect.fail(new Error(`Vite+ wrote no run plan to ${file}`))
      const lines = yield* Effect.try({ try: () => cacheLog(body), catch: error => error })
      for (const line of lines) yield* line.level === "Info" ? Effect.logInfo(line.message) : Effect.logDebug(line.message)
    }
    return yield* workspace.exec(`${vp} run -v ${quote(task)}`)
  }),
})
