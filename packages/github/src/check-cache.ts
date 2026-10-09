import { execFileSync } from "node:child_process"
import { sign, verify } from "node:crypto"
import type { CheckCache, CheckCacheRequest } from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

interface SignedCheckEvidence {
  readonly fingerprint: string
  readonly signature: string
}

export interface GitNotesCheckCacheOptions {
  readonly cwd: string
  readonly privateKey?: string
  readonly publicKey: string
  readonly ref?: string
}

export const checkFingerprint = (request: CheckCacheRequest): string => JSON.stringify({
  command: request.command,
  source: request.event.source,
  revision: request.event.revision,
  scope: request.policy.scope,
  stepId: request.stepId,
  workflowId: request.workflowId,
})

const git = (
  cwd: string,
  args: ReadonlyArray<string>,
): string => execFileSync("git", args, {
  cwd,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
}).trim()

const readEvidence = (
  options: GitNotesCheckCacheOptions,
  revision: string,
): ReadonlyArray<SignedCheckEvidence> => {
  try {
    const note = git(options.cwd, [
      "notes",
      `--ref=${options.ref ?? "effect-ci"}`,
      "show",
      revision,
    ])

    return JSON.parse(note) as ReadonlyArray<SignedCheckEvidence>
  } catch {
    return []
  }
}

const matchesCleanRevision = (cwd: string, revision: string): boolean => {
  try {
    return git(cwd, ["rev-parse", "HEAD"]) === revision &&
      git(cwd, ["status", "--porcelain", "--untracked-files=all"]) === ""
  } catch {
    return false
  }
}

export const gitNotesCheckCache = (
  options: GitNotesCheckCacheOptions,
): CheckCache => ({
  lookup: (request) => Effect.sync(() => {
    const revision = request.event.revision
    if (!revision || !matchesCleanRevision(request.workspace.cwd, revision)) return false

    const fingerprint = checkFingerprint(request)
    return readEvidence(options, revision).some((evidence) =>
      evidence.fingerprint === fingerprint && verify(
        null,
        Buffer.from(fingerprint),
        options.publicKey,
        Buffer.from(evidence.signature, "base64url"),
      )
    )
  }),
  record: (request) => Effect.sync(() => {
    const revision = request.event.revision
    if (!revision || !options.privateKey || !matchesCleanRevision(request.workspace.cwd, revision)) return

    const fingerprint = checkFingerprint(request)
    const existing = readEvidence(options, revision)
    const evidence: SignedCheckEvidence = {
      fingerprint,
      signature: Buffer.from(sign(
        null,
        Buffer.from(fingerprint),
        options.privateKey,
      )).toString("base64url"),
    }
    const records = [
      ...existing.filter((record) => record.fingerprint !== fingerprint),
      evidence,
    ]

    git(options.cwd, [
      "notes",
      `--ref=${options.ref ?? "effect-ci"}`,
      "add",
      "--force",
      "--message",
      JSON.stringify(records),
      revision,
    ])
  }),
})
