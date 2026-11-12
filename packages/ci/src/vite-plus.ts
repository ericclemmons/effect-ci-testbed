/** The parts of `vp run --dry-run --json` (Vite+ 1.6 run plan, version 1) that notes use. */
interface RunPlanStep {
  readonly expandedFrom?: string
  readonly plan?: RunPlan["plan"]
  readonly cache?: {
    readonly status: "hit" | "changed" | "unknown" | "noBaseline" | "error" | "disabled"
    readonly baseline?: { readonly durationMs: number }
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

const shownChanges = 5

const describeChange = (change: NonNullable<NonNullable<RunPlanStep["cache"]>["changes"]>[number]): string => {
  switch (change.kind) {
    case "file": return `'${change.path}' ${change.change}`
    case "env": return `env '${change.name}' ${change.change}`
    case "config": return `config '${change.setting}' changed`
    default: return `${change.kind} changed`
  }
}

const describeCache = (cache: RunPlanStep["cache"]): string => {
  if (!cache) return "not cached"
  switch (cache.status) {
    case "hit": return `cached${cache.baseline ? ` (saves ${cache.baseline.durationMs}ms)` : ""}`
    case "noBaseline": return "not cached: no earlier run to reuse"
    case "disabled": return "not cached: caching is off"
    case "error": return `not cached: ${cache.message ?? "cache unreadable"}`
    case "changed":
    case "unknown": {
      const changes = (cache.changes ?? []).map(describeChange)
      const more = changes.length > shownChanges ? `, ${changes.length - shownChanges} more` : ""
      const partial = cache.changesPartial ? ", maybe more" : ""
      const reasons = changes.length ? `${changes.slice(0, shownChanges).join(", ")}${more}${partial}` : ""
      return cache.status === "changed"
        ? `not cached: ${reasons}`
        : `cache unknown: an earlier step writes files first${reasons ? `; today ${reasons}` : ""}`
    }
  }
}

/** One note per step of a Vite+ run plan, such as `vite+ app#build: cached (saves 166ms)`. */
export const vitePlusCacheNotes = (body: string): string[] => {
  const plan = JSON.parse(body) as RunPlan
  if (plan.version !== 1 || typeof plan.plan !== "object" || plan.plan === null) {
    throw new Error("Expected a version 1 Vite+ run plan from `vp run --dry-run --json`")
  }
  const notes: string[] = []
  const visit = (tasks: RunPlan["plan"], prefix: string) => {
    for (const [id, task] of Object.entries(tasks)) {
      const single = task.steps.length === 1
      task.steps.forEach((step, index) => {
        const label = `${prefix}${id}${single ? "" : ` step ${index + 1}`}`
        if (step.plan) visit(step.plan, `${label} › `)
        else notes.push(`vite+ ${label}: ${describeCache(step.cache)}`)
      })
    }
  }
  visit(plan.plan, "")
  return notes
}
