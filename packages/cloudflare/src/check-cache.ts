import type { CheckCache, CheckCacheRequest } from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { hostedCheckBytes, verifyEnrolledCheckEvidence, type HostedCheckEnrollment, type HostedCheckIdentity } from "./check-evidence.ts"
import { readGitHubCheckNote, type GitHubCheckNoteReader } from "./check-note.ts"

export interface HostedCheckCacheOptions {
  readonly reader: GitHubCheckNoteReader
  readonly enrollments: ReadonlyArray<HostedCheckEnrollment>
  /** Trusted runner code must inspect the actual prepared workspace and runtime.
   * Return undefined for dirty, incomplete, or ineligible inputs. Never accept
   * project-provided digests or infer purity from a command's name.
   */
  readonly identify: (request: CheckCacheRequest) => Promise<HostedCheckIdentity | undefined>
  /** Optional host-only bounded diagnostic. Never contains notes, commands or credentials. */
  readonly onMiss?: (reason: string) => void
}

/** Public-only, read-only adapter. The runner owns eligibility, input identities,
 * enrollment and authenticated GET capability. No key, note write or automatic
 * enrollment is provided here. A miss always leaves ordinary execution intact.
 */
export const hostedCheckCache = (options: HostedCheckCacheOptions): CheckCache => ({
  lookup: request => Effect.promise(async () => {
    let stage = "source"
    const miss = (reason: string) => { options.onMiss?.(reason); return false }
    try {
      const source = request.event.source
      const repository = `https://github.com/${options.reader.repository}`
      if (request.policy.scope !== "commit" || source?.kind !== "git" ||
          source.repository.replace(/\.git$/, "") !== repository || source.revision !== request.event.revision ||
          !/^[0-9a-f]{40}$/.test(source.revision)) return miss("source")
      stage = "identity"
      const identity = await options.identify(request)
      if (!identity || identity.kind !== "check" || identity.repository !== repository ||
          identity.revision !== source.revision || identity.workflowId !== request.workflowId ||
          identity.stepId !== request.stepId || identity.command !== request.command) return miss("identity")
      // Snapshot trusted computed inputs before crossing the asynchronous network
      // boundary. The copied strings cannot be replaced by an incoming note.
      const expected: HostedCheckIdentity = {
        kind: "check", repository: identity.repository, revision: identity.revision,
        workflowId: identity.workflowId, stepId: identity.stepId, command: identity.command,
        policyDigest: identity.policyDigest, toolchainDigest: identity.toolchainDigest,
        sourceDigest: identity.sourceDigest,
      }
      stage = "canonical-inputs"
      hostedCheckBytes(expected)
      stage = "note-read"
      const note = await readGitHubCheckNote(options.reader, expected.revision)
      if (!note) return miss("note-unavailable")
      stage = "signature"
      const verified = await verifyEnrolledCheckEvidence(note.text, expected, options.enrollments)
      return verified || miss("signature")
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      const api = ["AbortController", "setTimeout", "Headers", "fetch", "crypto", "TextEncoder"]
        .find(name => message.includes(name))
      return miss(`${stage}:${api ?? (error instanceof TypeError ? "type-error" : "exception")}`)
    }
  }),
  // Hosted success does not mint local developer evidence or mutate notes.
  record: () => Effect.void,
})
