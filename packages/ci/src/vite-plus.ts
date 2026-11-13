import * as Effect from "effect/Effect"
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

/**
 * Cache hits whose run read no project file. fspy can miss every read of some native tools,
 * such as TypeScript 7's `tsc` on macOS (voidzero-dev/vite-task#587). Such a hit would replay
 * a stale result forever, so it must not be trusted. Needs a `-vv` plan.
 */
export const untracedHits = (body: string): string[] => {
  const plan = JSON.parse(body) as RunPlan
  const labels: string[] = []
  const visit = (tasks: RunPlan["plan"], prefix: string) => {
    for (const [id, task] of Object.entries(tasks)) {
      task.steps.forEach((step, index) => {
        const label = `${prefix}${id}${task.steps.length === 1 ? "" : ` step ${index + 1}`}`
        if (step.plan) return visit(step.plan, `${label} › `)
        if (step.cache?.status !== "hit") return
        const paths = Object.keys(step.cache.baseline?.fingerprint?.inputs ?? {})
        if (!paths.some(path => path !== "." && path !== "node_modules" && !path.startsWith("node_modules/"))) {
          labels.push(label)
        }
      })
    }
  }
  visit(plan.plan, "")
  return labels
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

// Prefer the global vp; fall back to the project's own when a runner has none.
const vp = `PATH="$PATH:$PWD/node_modules/.bin" vp`

// Scripts whose result depends only on files they read. Deploy, publish, dev and
// in-place formatting scripts have effects a file cache cannot replay.
const cacheableScripts = new Set(["build", "test", "lint", "check", "typecheck", "compile"])

/** Whether zero-config CI caches a package script with `vp run --cache`, by its name. */
export const isCacheableScript = (name: string): boolean => {
  const [kind = ""] = name.split(":")
  return cacheableScripts.has(kind)
}

/** Vite+ in a project, through the global `vp` CLI. */
export const VitePlus = (workspace: CI.Workspace) => Effect.succeed({
  workspace,
  /**
   * Runs a Vite+ task with `vp run -v`. A dry run first logs whether each step would hit the
   * cache, and every change behind a miss; at Debug, also the cached run's inputs and outputs.
   * A forced run (`effect-ci run --force`) adds `--no-cache`, so every step runs.
   *
   * `cache: true` adds `--cache`, so package.json scripts are cached too. Vite+ then infers
   * each script's inputs and outputs from the files it reads and writes. Cached scripts run
   * with a clean environment: only common variables such as `PATH`, `HOME` and `CI` pass through.
   */
  run: (task: string, options: { readonly cache?: boolean } = {}) => Effect.gen(function* () {
    let noCache = (yield* CI.force) ? " --no-cache" : options.cache ? " --cache" : ""
    let traced = !(yield* CI.force)
    if ((yield* CI.executionMode) === "execute") {
      // Always -vv: the cached run's inputs show whether its trace can be trusted.
      // Its Debug lines only print at -vv.
      const verbose = "-vv"
      // In node_modules, so the plan is never an input of the task it describes.
      // One file per task, so parallel steps never read each other's plan.
      const file = `node_modules/.effect-ci-vite-plus-run-plan-${task.replaceAll(/[^\w-]/g, "_")}.json`
      yield* workspace.exec(`mkdir -p node_modules && ${vp} run --dry-run --json${noCache} ${verbose} ${quote(task)} > ${file}`,
        { diagnostic: true })
      const body = yield* workspace.readFile(file)
      if (body === undefined) return yield* Effect.fail(new Error(`Vite+ wrote no run plan to ${file}`))
      const lines = yield* Effect.try({ try: () => cacheLog(body), catch: error => error })
      for (const line of lines) yield* line.level === "Info" ? Effect.logInfo(line.message) : Effect.logDebug(line.message)
      const untraced = traced ? untracedHits(body) : []
      if (untraced.length > 0) {
        yield* Effect.logWarning(`vite+ ${untraced.join(", ")}: the cached run read no project files, so running without the cache`)
        noCache = " --no-cache"
        traced = false
      }
    }
    return yield* workspace.exec(`${vp} run -v${noCache} ${quote(task)}`,
      traced ? { trace: { tool: "vite-plus", task } } : undefined)
  }),
})
