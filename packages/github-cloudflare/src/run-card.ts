import type { ApprovalRequest, PlanNode, RuntimeEvent } from "@effect-ci-testbed/ci"

export type SlackBlock = Readonly<Record<string, unknown>>
interface RunIdentity {
  readonly instanceId: string
  readonly repository: string
  readonly revision: string
  readonly detailsUrl?: string
  readonly slackApprovalsEnabled?: boolean
}

const symbols: Record<PlanNode["status"] | "waiting" | "approved" | "rejected", string> = {
  planned: "⏳", queued: "⏳", running: "▶️", complete: "✅",
  reused: "♻️", verified: "✅", warning: "⚠️", failed: "❌", skipped: "➖",
  waiting: "⏳", approved: "✅", rejected: "❌",
}
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
const safeUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password ? url.href.replaceAll("|", "%7C") : undefined
  } catch { return undefined }
}
const link = (url: string | undefined, label: string): string => url ? `<${escape(url)}|${escape(label)}>` : escape(label)

/** Only recognize canonical GitHub identities; arbitrary sources remain plain, escaped text. */
const sourceLinks = (identity: RunIdentity): string => {
  const repository = identity.repository.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")
  const valid = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
  const url = valid ? `https://github.com/${repository}` : undefined
  const commit = /^[a-f0-9]{7,64}$/i.test(identity.revision)
  const revision = commit ? identity.revision.slice(0, 7) : identity.revision
  return `${link(url, repository.slice(0, 200))}@${link(url && commit ? `${url}/commit/${identity.revision}` : undefined, revision.slice(0, 100))}${safeUrl(identity.detailsUrl) ? ` • ${link(safeUrl(identity.detailsUrl), "Details")}` : ""}`
}

/** Reconstructed from runtime events on replay; never stores output or secrets. */
export class RunCard {
  private workflowId = "Effect CI"
  private phase: "running" | "waiting" | "success" | "failure" = "running"
  private readonly checks = new Map<string, { status: keyof typeof symbols; optional: boolean; dependencies: Set<string> }>()
  private review: { stepId: string; request: ApprovalRequest; url?: string } | undefined
  private readonly identity: RunIdentity

  constructor(identity: RunIdentity) {
    this.identity = identity
  }

  private check(id: string) {
    let check = this.checks.get(id)
    if (!check) {
      check = { status: "queued" as const, optional: false, dependencies: new Set<string>() }
      this.checks.set(id, check)
    }

    return check
  }

  update(event: RuntimeEvent): boolean {
    this.workflowId = event.workflowId
    switch (event.type) {
      case "workflow.started": return true
      case "step.status":
        Object.assign(this.check(event.stepId), { status: event.status, optional: event.optional })

        return true
      case "dependency.added":
        this.check(event.stepId).dependencies.add(event.dependency)

        return false
      case "workflow.plan":
        for (const node of event.plan.nodes) {
          Object.assign(this.check(node.id), { status: node.status, optional: node.optional, dependencies: new Set(node.dependencies) })
        }

        return true
      case "approval.requested":
        this.phase = "waiting"
        this.check(event.stepId).status = "waiting"
        this.review = { stepId: event.stepId, request: event.approval }

        return true
      case "approval.resolved":
        this.phase = event.decision === "approved" ? "running" : "failure"
        this.check(event.stepId).status = event.decision
        this.review = undefined

        return true
      case "workflow.completed":
        this.phase = event.conclusion
        this.review = undefined

        return true
      default: return false
    }
  }

  setReviewUrl(url: string): void {
    if (this.review) this.review.url = url
  }

  render(): { text: string; blocks: ReadonlyArray<SlackBlock> } {
    const ordered: Array<string> = []
    const visited = new Set<string>()
    const visit = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)
      for (const dependency of this.checks.get(id)?.dependencies ?? []) visit(dependency)
      if (this.checks.has(id)) ordered.push(id)
    }
    for (const id of this.checks.keys()) visit(id)

    const headline = { running: "▶️ Running", waiting: "⏳ Waiting for approval", success: "✅ Passed", failure: "❌ Failed" }[this.phase]
    const lines = ordered.map((id) => {
      const check = this.checks.get(id)!

      return `${symbols[check.status]} ${id}${check.status === "complete" ? "" : ` — ${check.status}`}${check.optional ? " (optional)" : ""}`
    })
    const blocks: Array<SlackBlock> = [
      { type: "header", text: { type: "plain_text", text: `${headline} · ${this.workflowId}`.slice(0, 150) } },
      { type: "context", elements: [{ type: "mrkdwn", text: sourceLinks(this.identity), verbatim: true }] },
      { type: "divider" },
    ]
    // One compact checklist, split into sections to respect Slack's text limit.
    let section = ""
    for (const line of lines.slice(0, 100)) {
      const safe = escape(line).slice(0, 500)
      if (section.length + safe.length > 2800) {
        blocks.push({ type: "section", text: { type: "mrkdwn", text: section, verbatim: true } })
        section = ""
      }
      section += `${safe}\n`
    }
    blocks.push({ type: "section", text: { type: "mrkdwn", text: section || "Preparing checks…", verbatim: true } })
    if (lines.length > 100) blocks.push({ type: "context", elements: [{ type: "plain_text", text: `${lines.length - 100} more checks; see Workflow history.` }] })
    if (this.review) {
      blocks.push({ type: "section", text: { type: "plain_text", text: `${this.review.request.title}\n${this.review.request.summary}`.slice(0, 3000) } })
    }
    const reviewUrl = this.review?.url ? new URL(this.review.url) : undefined
    const token = reviewUrl?.searchParams.get("token")
    const requestId = reviewUrl?.pathname.split("/").at(-1)
    const value = this.identity.slackApprovalsEnabled && token && requestId ? JSON.stringify({ instanceId: this.identity.instanceId, requestId: decodeURIComponent(requestId), token }) : undefined
    const buttons = [
      ...(value ? [
        { type: "button", text: { type: "plain_text", text: "Approve" }, style: "primary", action_id: "approve_release", value },
        { type: "button", text: { type: "plain_text", text: "Reject" }, style: "danger", action_id: "reject_release", value },
      ] : []),
    ]
    if (buttons.length) blocks.push({ type: "actions", elements: buttons })

    const review = this.review ? `\n${this.review.request.title}\n${this.review.request.summary}` : ""

    return { text: `${headline} · ${this.workflowId}\n${lines.join("\n")}${review}\nRun: ${this.identity.instanceId}`, blocks }
  }
}
