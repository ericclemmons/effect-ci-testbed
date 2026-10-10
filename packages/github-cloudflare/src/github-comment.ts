import * as Effect from "effect/Effect"
import type { NotificationProvider, NotificationReceipt, RunSnapshot } from "./notification-service.ts"

export interface GitHubCommentOptions {
  readonly repository: string
  /** Supplied by a verified event/integration, not inferred from branch names. */
  readonly pullRequest: number
  readonly botUserId: number
  readonly token: () => Promise<string>
  readonly transport?: typeof fetch
}

const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const text = (value: string) => value.slice(0, 200).replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("@", "&#64;")
  .replace(/[\\`*_\[\]()~|]/g, "\\$&").replace(/[\r\n]/g, " ")
const safeDetails = (value: string | undefined) => {
  try {
    const url = new URL(value ?? "")
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href.replace(/[()<>]/g, (character) => encodeURIComponent(character)) : undefined
  } catch { return undefined }
}

export const renderGitHubComment = (run: RunSnapshot): string => {
  const phase = { running: "▶️ Running", waiting: "⏳ Waiting for approval", success: "✅ Passed", failure: "❌ Failed" }[run.phase]
  const repo = run.identity.repository.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")
  const url = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ? `https://github.com/${repo}` : undefined
  const sha = /^[a-f0-9]{7,64}$/i.test(run.identity.revision) ? run.identity.revision : undefined
  const source = url ? `[${text(repo)}](${url})` : text(repo)
  const revision = url && sha ? `[${sha.slice(0, 7)}](${url}/commit/${sha})` : text(run.identity.revision)
  const details = safeDetails(run.identity.detailsUrl)
  const symbols = { planned: "⏳", queued: "⏳", running: "▶️", complete: "✅", reused: "♻️", verified: "✅", warning: "⚠️", failed: "❌", skipped: "➖", waiting: "⏳", approved: "✅", rejected: "❌" }
  const checks = run.checks.slice(0, 100).map((check) =>
    `${symbols[check.status]} ${text(check.id)}${check.status === "complete" ? "" : ` — ${check.status}`}${check.optional ? " (optional)" : ""}`)
  return `### ${phase} · ${text(run.workflowId)}\n\n${source}@${revision}${details ? ` • [Details](${details})` : ""}\n\n${checks.join("  \n") || "Preparing checks…"}${run.checks.length > 100 ? "\n\nAdditional checks are available in Details." : ""}`
}

/** One maintained comment per run/PR. Separate runs cannot overwrite each other.
 * Receipt recovery scans at most 500 comments and fails closed on ambiguity or overflow.
 * External posting is not exactly-once, but replay can rediscover an acknowledged post.
 */
export const githubCommentProvider = (options: GitHubCommentOptions): NotificationProvider => {
  options = { ...options }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository) ||
    !positiveId(options.pullRequest) || !positiveId(options.botUserId)) throw new Error("Invalid GitHub comment destination")
  const base = `https://api.github.com/repos/${options.repository}`
  const issue = `${base}/issues/${options.pullRequest}`.toLowerCase()
  const transport = options.transport ?? fetch
  return {
    id: "github-comment",
    deliver: (run, previous) => Effect.tryPromise({
      try: async (): Promise<NotificationReceipt> => {
        const repository = run.identity.repository.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")
        if (repository.toLowerCase() !== options.repository.toLowerCase()) throw new Error("Wrong notification repository")
        const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([
          options.repository.toLowerCase(), options.pullRequest, run.identity.instanceId, run.identity.revision,
        ])))
        const identity = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
        const marker = `<!-- effect-ci-run:${identity} -->`
        const body = `${marker}\n${renderGitHubComment(run)}`
        const token = await options.token()
        const request = async (path: string, method = "GET", value?: unknown): Promise<any> => {
          const response = await transport(`${base}${path}`, {
            method, redirect: "error", signal: AbortSignal.timeout(10_000),
            headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json",
              "content-type": "application/json", "user-agent": "effect-ci-testbed", "x-github-api-version": "2026-03-10" },
            ...(value ? { body: JSON.stringify(value) } : {}),
          })
          if (!response.ok) { await response.body?.cancel(); throw new Error("GitHub comment delivery failed") }
          const reader = response.body?.getReader()
          if (!reader) throw new Error("Missing GitHub response")
          const chunks: Uint8Array[] = []
          let length = 0
          try {
            for (;;) {
              const chunk = await reader.read()
              if (chunk.done) break
              length += chunk.value.length
              if (length > 2 * 1024 * 1024) throw new Error("GitHub response exceeds notification limit")
              chunks.push(chunk.value)
            }
          } finally { await reader.cancel() }
          const json = new Uint8Array(length)
          let offset = 0
          for (const chunk of chunks) { json.set(chunk, offset); offset += chunk.length }
          return JSON.parse(new TextDecoder().decode(json))
        }
        const owned = (comment: any): boolean => positiveId(comment?.id) &&
          comment.user?.id === options.botUserId && comment.user?.type === "Bot" &&
          typeof comment.issue_url === "string" && comment.issue_url.toLowerCase() === issue &&
          typeof comment.body === "string" && comment.body.startsWith(`${marker}\n`)
        let comment: any
        if (previous) {
          if (previous.identity !== identity || !/^[1-9][0-9]*$/.test(previous.commentId ?? "") ||
            !positiveId(Number(previous.commentId))) throw new Error("Invalid comment receipt")
          comment = await request(`/issues/comments/${previous.commentId}`)
          if (!owned(comment) || String(comment.id) !== previous.commentId) throw new Error("Comment ownership mismatch")
        } else {
          for (let page = 1; page <= 5; page++) {
            const comments = await request(`/issues/${options.pullRequest}/comments?per_page=100&page=${page}`)
            if (!Array.isArray(comments) || comments.length > 100) throw new Error("Invalid GitHub comment page")
            for (const item of comments.filter(owned)) {
              if (comment) throw new Error("Ambiguous notification comment")
              comment = item
            }
            if (comments.length < 100) break
            if (page === 5) throw new Error("Comment discovery limit reached")
          }
        }
        const result = comment
          ? comment.body === body ? comment : await request(`/issues/comments/${comment.id}`, "PATCH", { body })
          : await request(`/issues/${options.pullRequest}/comments`, "POST", { body })
        if (!owned(result) || (comment && result.id !== comment.id)) throw new Error("Invalid GitHub comment acknowledgement")
        return { identity, commentId: String(result.id) }
      },
      // Neither API error bodies nor transport errors may leak tokens/URLs into events.
      catch: () => new Error("GitHub comment notification failed"),
    }),
  }
}
