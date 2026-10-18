import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import type { CommandExecutor, SourceService, WorkflowEventShape } from "./index.ts"
import { pathGlob, pathPatterns } from "./path-glob.ts"

/** Explicit committed comparison. Use mergeBase for a PR's branch-point diff. */
export interface SourceComparison {
  readonly base: string
  readonly head?: string
  readonly mergeBase?: boolean
}

export type SourceChanges =
  | { readonly status: "known"; readonly paths: ReadonlyArray<string>; readonly base: string; readonly head: string }
  | { readonly status: "unknown"; readonly reason: "unavailable" | "no-baseline" | "plan" }

export interface SourceQueries extends SourceService {
  readonly changes: (comparison?: SourceComparison) => Effect.Effect<SourceChanges, unknown>
  /** Unknown comparisons conservatively match. Paths are repository-relative. */
  readonly changed: (patterns: string | ReadonlyArray<string>, comparison?: SourceComparison) => Effect.Effect<boolean, unknown>
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const sha = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/
const unavailable = { status: "unknown", reason: "unavailable" } as const
const normalize = (value: SourceChanges): SourceChanges => {
  if (value?.status !== "known") return value?.status === "unknown" &&
    ["unavailable", "no-baseline", "plan"].includes(value.reason) ? value : unavailable
  if (typeof value.base !== "string" || !value.base || value.base.length > 512 ||
      typeof value.head !== "string" || !value.head || value.head.length > 512 || !Array.isArray(value.paths) ||
      value.paths.length > 100_000 || value.paths.some(path => typeof path !== "string" ||
        !path || path.startsWith("/") || path.includes("\0") || path.split("/").some(part => part === ".." || part === ".")) ||
      value.paths.reduce((length, path) => length + path.length + 1, 0) > 1_048_576) return unavailable
  return { status: "known", base: value.base, head: value.head, paths: [...new Set(value.paths)].sort() }
}

/** Fixed, read-only Git query shared by local and native source providers. */
export function gitSourceChangesCommand(selected: SourceComparison, revision = "HEAD"): string | undefined {
  const target = selected.head ?? revision
  if (typeof selected.base !== "string" || typeof target !== "string" || !selected.base || !target ||
    selected.base.length > 512 || target.length > 512 || /[\x00-\x1f]/.test(selected.base + target)) return undefined
  return [
    // Avoid index refresh writes while inspecting committed source.
    'dirty=$(git --no-optional-locks -c core.fsmonitor=false status --porcelain --untracked-files=normal)',
    'test -z "$dirty"',
    `base=$(git rev-parse --verify --end-of-options ${quote(selected.base + "^{commit}")})`,
    `head=$(git rev-parse --verify --end-of-options ${quote(target + "^{commit}")})`,
    'current=$(git rev-parse --verify HEAD)',
    'test "$current" = "$head"',
    ...(selected.mergeBase ? ['base=$(git merge-base "$base" "$head")'] : []),
    "printf '%s\\0%s\\0' \"$base\" \"$head\"",
    'git --no-pager diff --no-ext-diff --no-textconv --no-relative --no-renames --name-only -z "$base" "$head" --',
  ].join(" && ")
}

export function parseGitSourceChanges(result: { readonly stdout: string; readonly exitCode: number }): SourceChanges {
  if (result.exitCode !== 0 || result.stdout.length > 1_048_576) return unavailable
  const [base, head, ...paths] = result.stdout.split("\0")
  if (!base || !head || !sha.test(base) || !sha.test(head) || paths.pop() !== "" || paths.length > 100_000) return unavailable
  return normalize({ status: "known", base, head, paths })
}

export function makeSourceQueries(source: SourceService, options: {
  readonly executor: CommandExecutor
  readonly workflowId: string
  readonly event: WorkflowEventShape
  readonly mode: "plan" | "execute"
}): SourceQueries {
  let sequence = 0
  const changes = (comparison?: SourceComparison): Effect.Effect<SourceChanges, unknown> => {
    const query = Effect.gen(function* () {
      // Arbitrary if/else cannot describe both branches. Planning does not fetch
      // source or inspect the developer's filesystem to choose one silently.
      if (options.mode === "plan") return { status: "unknown", reason: "plan" } as const
      const selected = comparison ?? options.event.comparison ??
        (source.reference?.kind === "local" && !options.event.revision
          ? { base: "refs/remotes/origin/HEAD", mergeBase: true } : undefined)
      if (source.changes) return normalize(yield* source.changes(selected))
      if (!selected) return { status: "unknown", reason: "no-baseline" } as const
      if (source.reference && source.reference.kind !== "git" && source.reference.kind !== "local") return unavailable
      const command = gitSourceChangesCommand(selected, options.event.revision)
      if (!command) return unavailable
      const workspace = yield* source.checkout()
      const result = yield* options.executor.execute({ workspace, command, workflowId: options.workflowId,
        stepId: "$source-changes", commandIndex: ++sequence,
        options: { timeout: "30 seconds", retries: { limit: 0, delay: 0, backoff: "constant" } }, onOutput: () => {} })
      return parseGitSourceChanges(result)
    })
    return query.pipe(Effect.timeout("30 seconds"), Effect.catchCause(cause => Cause.hasFails(cause) || Cause.hasDies(cause)
      ? Effect.succeed({ status: "unknown", reason: "unavailable" } as const)
      : Effect.failCause(cause)))
  }
  return {
    checkout: () => source.checkout(),
    ...(source.reference ? { reference: source.reference } : {}),
    changes,
    changed: (patterns, comparison) => Effect.suspend(() => {
      const matchers = pathPatterns(patterns).map(pathGlob)
      return changes(comparison).pipe(Effect.map(result => result.status === "unknown" ||
        result.paths.some(path => matchers.some(pattern => pattern.test(path)))))
    }),
  }
}
