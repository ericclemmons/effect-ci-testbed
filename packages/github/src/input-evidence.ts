import { execFileSync } from "node:child_process"
import { createHash, sign, verify } from "node:crypto"
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { relative, resolve } from "node:path"
import type { CheckCache, CheckCacheRequest } from "@effect-ci-testbed/ci"
import { untracedHits } from "@effect-ci-testbed/ci/vite-plus"
import * as Effect from "effect/Effect"

/** What a passing run read, as Vite+ traced it, with content digests Effect CI computes. */
type PathEvidence =
  | { readonly type: "file"; readonly sha256: string; readonly mayBeMissing?: true }
  | { readonly type: "dir"; readonly entries?: ReadonlyArray<string>; readonly mayBeMissing?: true }
  | { readonly type: "missing" }

interface InputEvidence {
  /** The Vite+ workspace root, relative to the check's working directory. */
  readonly root: string
  readonly inputs: Readonly<Record<string, PathEvidence>>
  /** SHA-256 of each env var value the run's cache key includes. */
  readonly env: Readonly<Record<string, string | null>>
}

interface SignedInputEvidence {
  readonly evidence: InputEvidence
  readonly signature: string
}

export interface InputEvidenceCheckCacheOptions {
  /** A Git checkout whose notes ref stores the evidence. Push the ref to share it. */
  readonly cwd: string
  readonly privateKey?: string
  readonly publicKey: string
  readonly ref?: string
}

/** Evidence is keyed by what ran, never by commit, so it survives rebases and squashes. */
export const inputEvidenceKey = (request: CheckCacheRequest): string => JSON.stringify({
  command: request.command,
  repository: request.event.source?.kind === "git" ? request.event.source.repository : undefined,
  scope: request.policy.scope,
  stepId: request.stepId,
  task: request.trace?.task,
  workflowId: request.workflowId,
})

// Keep the newest records; a check rarely has more live input sets than branches.
const maximumRecords = 20

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")

const git = (cwd: string, args: ReadonlyArray<string>, input?: string): string => execFileSync("git", args, {
  cwd,
  encoding: "utf8",
  input,
  stdio: ["pipe", "pipe", "ignore"],
}).trim()

// Notes can annotate any object name. Hashing the key gives a stable, commit-free name.
const keyObject = (cwd: string, key: string) => git(cwd, ["hash-object", "--stdin"], key)

const canonical = (evidence: InputEvidence) => JSON.stringify(evidence, (_key, value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : value)

interface PlanStep {
  readonly plan?: Plan["plan"]
  readonly cache?: {
    readonly status: string
    readonly baseline?: {
      readonly fingerprint?: {
        readonly env?: ReadonlyArray<string>
        readonly inputs?: Readonly<Record<string,
          | { readonly type: "file"; readonly mayBeMissing?: true }
          | { readonly type: "dir"; readonly entries?: ReadonlyArray<string>; readonly mayBeMissing?: true }
          | { readonly type: "missing" }>>
      }
    }
  }
}

interface Plan {
  readonly version: number
  readonly workspaceRoot: string
  readonly plan: Readonly<Record<string, { readonly steps: ReadonlyArray<PlanStep> }>>
}

/** Every leaf step of a `vp run --dry-run --json -vv` plan. */
const leafSteps = (plan: Plan["plan"]): PlanStep[] => Object.values(plan).flatMap(task =>
  task.steps.flatMap(step => step.plan ? leafSteps(step.plan) : [step]))

const digestFile = (path: string) => sha256(readFileSync(path))

/** Ask Vite+ what the run it just cached read. Undefined when any step is not cached. */
const traceRun = (cwd: string, task: string): InputEvidence | undefined => {
  const body = execFileSync("sh", ["-c", 'PATH="$PATH:$PWD/node_modules/.bin" exec vp run --dry-run --json --cache -vv "$1"', "sh", task], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 16 * 1024 * 1024,
  })
  const plan = JSON.parse(body) as Plan
  // A trace that saw no project file proves nothing about the project.
  if (plan.version !== 1 || untracedHits(body).length > 0) return undefined
  const steps = leafSteps(plan.plan)
  if (steps.length === 0 || steps.some(step => step.cache?.status !== "hit")) return undefined
  const inputs: Record<string, PathEvidence> = {}
  const env: Record<string, string | null> = {}
  for (const step of steps) {
    const fingerprint = step.cache?.baseline?.fingerprint
    for (const [path, input] of Object.entries(fingerprint?.inputs ?? {})) {
      const absolute = resolve(plan.workspaceRoot, path)
      if (input.type === "file") {
        // A rebuildable file the run deleted is fine to be missing next time.
        if (!existsSync(absolute)) {
          if (!input.mayBeMissing) return undefined
          inputs[path] = { type: "missing" }
        } else inputs[path] = { type: "file", sha256: digestFile(absolute), ...(input.mayBeMissing ? { mayBeMissing: true } : {}) }
      } else inputs[path] = input
    }
    for (const name of fingerprint?.env ?? []) {
      const value = process.env[name]
      env[name] = value === undefined ? null : sha256(value)
    }
  }
  // Vite+ reports a resolved root, as macOS /private/var for /var.
  return { root: relative(realpathSync(cwd), realpathSync(plan.workspaceRoot)) || ".", inputs, env }
}

/** Whether the workspace still has every input exactly as the passing run read it. */
const matches = (cwd: string, evidence: InputEvidence): boolean => {
  const root = resolve(cwd, evidence.root)
  for (const [path, input] of Object.entries(evidence.inputs)) {
    const absolute = resolve(root, path)
    const relativePath = relative(root, absolute)
    if (relativePath.startsWith("..")) return false
    const exists = existsSync(absolute)
    switch (input.type) {
      case "missing":
        if (exists) return false
        break
      case "file":
        if (!exists) { if (!input.mayBeMissing) return false; break }
        if (!statSync(absolute).isFile() || digestFile(absolute) !== input.sha256) return false
        break
      case "dir": {
        if (!exists) { if (!input.mayBeMissing) return false; break }
        if (!statSync(absolute).isDirectory()) return false
        if (input.entries) {
          const entries = readdirSync(absolute).sort()
          if (entries.join("\0") !== [...input.entries].sort().join("\0")) return false
        }
      }
    }
  }
  for (const [name, digest] of Object.entries(evidence.env)) {
    const value = process.env[name]
    if ((value === undefined ? null : sha256(value)) !== digest) return false
  }
  return true
}

const readRecords = (options: InputEvidenceCheckCacheOptions, object: string): ReadonlyArray<SignedInputEvidence> => {
  try {
    return JSON.parse(git(options.cwd, ["notes", `--ref=${options.ref ?? "effect-ci-inputs"}`, "show", object]))
  } catch {
    return []
  }
}

/**
 * Reuses a passing Vite+ check when every file and env var it read is unchanged, on any
 * commit. A trusted writer signs what Vite+ traced; a reader recomputes each digest.
 * Commands without a Vite+ trace and checks without `scope: "inputs"` always run.
 */
export const inputEvidenceCheckCache = (options: InputEvidenceCheckCacheOptions): CheckCache => ({
  lookup: (request) => Effect.sync(() => {
    if (request.policy.scope !== "inputs" || !request.trace || request.workspace.kind !== "local") return false
    const object = keyObject(options.cwd, inputEvidenceKey(request))
    return readRecords(options, object).some(({ evidence, signature }) =>
      verify(null, Buffer.from(canonical(evidence)), options.publicKey, Buffer.from(signature, "base64url")) &&
      matches(request.workspace.cwd, evidence))
  }),
  record: (request) => Effect.sync(() => {
    if (request.policy.scope !== "inputs" || !request.trace || !options.privateKey ||
      request.workspace.kind !== "local") return
    const evidence = traceRun(request.workspace.cwd, request.trace.task)
    if (!evidence) return
    const signature = Buffer.from(sign(null, Buffer.from(canonical(evidence)), options.privateKey)).toString("base64url")
    const object = keyObject(options.cwd, inputEvidenceKey(request))
    const records = [
      { evidence, signature },
      ...readRecords(options, object).filter(record => canonical(record.evidence) !== canonical(evidence)),
    ].slice(0, maximumRecords)
    git(options.cwd, ["notes", `--ref=${options.ref ?? "effect-ci-inputs"}`, "add", "--force",
      "--message", JSON.stringify(records), object])
  }),
})
