import type { SourceComparison } from "@effect-ci-testbed/ci"

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value)

/** Normalize GitHub's actual event comparison, never a changed-files summary.
 * Missing/mismatched metadata leaves changes unknown so the source runs work.
 */
export function githubSourceComparison(type: string, payload: unknown, revision?: string): SourceComparison | undefined {
  const event = record(payload)
  if (type === "push" && sha(event.before) && sha(event.after) && (!revision || revision === event.after))
    return { base: event.before, head: event.after }
  if (type === "merge_group") {
    const group = record(event.merge_group)
    if (sha(group.base_sha) && sha(group.head_sha) && (!revision || revision === group.head_sha))
      return { base: group.base_sha, head: group.head_sha }
  }
  if (type === "pull_request") {
    const pr = record(event.pull_request), base = record(pr.base).sha, head = record(pr.head).sha
    if (!sha(base) || !sha(head)) return
    if (!revision || revision === head) return { base, head, mergeBase: true }
    // Actions normally checks out the synthetic integration commit, not PR HEAD.
    if (sha(pr.merge_commit_sha) && revision === pr.merge_commit_sha)
      return { base, head: revision }
  }
}
