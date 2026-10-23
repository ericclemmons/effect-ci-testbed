import type { ApprovalRequest, PlanNode, RuntimeEvent } from "@effect-ci-testbed/ci"
import { copyHealthMetrics, type HealthMetrics } from "./health-metrics.ts"
import { failedCommandOutput } from "./failed-command-output.ts"

export type SlackBlock = Readonly<Record<string, unknown>>
export interface RunHealth {
  readonly phase: 10 | 25 | 75 | 100
  readonly decision: "uncertain" | "advance" | "rollback" | "regression"
  readonly evidenceSource: "closed-client-http-cohort" | "native-wobs" | "experimental-native-wobs"
  readonly metrics?: Readonly<HealthMetrics>
}
export interface RunIdentity {
  readonly instanceId: string
  readonly repository: string
  readonly revision: string
  readonly detailsUrl?: string
  readonly slackApprovalsEnabled?: boolean
}

/** Provider-neutral status only: no output, event payloads, or approval capabilities. */
export interface RunSnapshot {
  readonly identity: Readonly<Pick<RunIdentity, "instanceId" | "repository" | "revision" | "detailsUrl">>
  readonly workflowId: string
  readonly phase: "running" | "waiting" | "success" | "failure"
  readonly health?: Readonly<RunHealth>
  readonly checks: ReadonlyArray<{
    readonly id: string
    readonly status: keyof typeof symbols
    readonly optional: boolean
    readonly dependencies: ReadonlyArray<string>
    readonly failureReason?: string
  }>
}

const symbols: Record<PlanNode["status"] | "waiting" | "approved" | "rejected", string> = {
  planned: "⏳", queued: "⏳", running: "▶️", complete: "✅",
  reused: "♻️", verified: "✅", warning: "⚠️", failed: "❌", skipped: "➖",
  waiting: "⏳", approved: "✅", rejected: "❌",
}
const plainSymbols = { planned: "∗", queued: "∗", running: "►", complete: "✓", reused: "✓", verified: "✓",
  warning: "!", failed: "✗", skipped: "–", waiting: "∗", approved: "✓", rejected: "✗" } as const
const finished = new Set(["complete", "reused", "verified", "warning", "failed", "skipped", "approved", "rejected"])
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
  return `${link(url, repository.slice(0, 200))}@${link(url && commit ? `${url}/commit/${identity.revision}` : undefined, revision.slice(0, 100))}${safeUrl(identity.detailsUrl) ? ` • ${link(safeUrl(identity.detailsUrl), "Dashboard")}` : ""}`
}

/** Reconstructed on replay. Enrolled redacted failure presentation stays outside semantic snapshots. */
export class RunCard {
  private workflowId = "Effect CI"
  private phase: "running" | "waiting" | "success" | "failure" = "running"
  private readonly checks = new Map<string, { status: keyof typeof symbols; optional: boolean; dependencies: Set<string> }>()
  private readonly timings = new Map<string, { start: number; end?: number }>()
  private latestTimestamp = 0
  private review: { stepId: string; request: ApprovalRequest; url?: string } | undefined
  private health: Readonly<RunHealth & { fileId?: string }> | undefined
  private lastHealthChart: Readonly<{ phase: RunHealth["phase"]; fileId: string }> | undefined
  private readonly identity: RunIdentity
  private readonly failures = new Map<string, string>()
  private resultLink: { label: string; url: string } | undefined
  private readonly commandFailures = new Map<string, ReturnType<typeof failedCommandOutput>>()
  private readonly attachedLogs = new Set<string>()

  commandLog(stepId: string): string | undefined {
    const output = this.commandFailures.get(stepId)
    return output && output.text.length > 1200 ? output.snippetText : undefined
  }

  attachCommandLog(stepId: string, fileId: string): void {
    if (/^F[A-Z0-9]+$/.test(fileId) && this.commandFailures.has(stepId)) this.attachedLogs.add(stepId)
  }
  private lastCompletedStep: string | undefined
  private readonly progressSteps: ReadonlyArray<string> | undefined
  private readonly options: { failedCommandOutput?: { redactValues: ReadonlyArray<string> }; cachedDependencies?: Readonly<Record<string, ReadonlyArray<string>>> }

  constructor(identity: RunIdentity, options: { failedCommandOutput?: { redactValues: ReadonlyArray<string> }; progressSteps?: ReadonlyArray<string>; cachedDependencies?: Readonly<Record<string, ReadonlyArray<string>>> } = {}) {
    this.identity = identity
    this.options = options
    if (options.progressSteps && (options.progressSteps.length > 100 || new Set(options.progressSteps).size !== options.progressSteps.length ||
        options.progressSteps.some(id => !id.trim() || id.length > 200 || /[\r\n]/.test(id)))) throw Error("Invalid progress steps")
    this.progressSteps = options.progressSteps ? Object.freeze([...options.progressSteps]) : undefined
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
    const timestamp = Date.parse(event.timestamp)
    if (Number.isFinite(timestamp)) this.latestTimestamp = Math.max(this.latestTimestamp, timestamp)
    switch (event.type) {
      case "workflow.started": return true
      case "step.status":
        Object.assign(this.check(event.stepId), { status: event.status, optional: event.optional })
        if (Number.isFinite(timestamp)) {
          if (event.status === "running" && (!this.timings.has(event.stepId) || this.timings.get(event.stepId)!.end !== undefined))
            this.timings.set(event.stepId, { start: timestamp })
          else if (finished.has(event.status)) {
            const timing = this.timings.get(event.stepId)
            if (timing) timing.end = timestamp
          }
        }
        if (event.status === "reused") {
          // A trusted host can declare prerequisites covered by this signed result.
          // These are display states, never execution or approval authority.
          for (const id of this.options.cachedDependencies?.[event.stepId] ?? []) {
            if (!this.checks.has(id) || ["planned", "queued"].includes(this.checks.get(id)!.status))
              this.check(id).status = "reused"
          }
        }
        if (["complete", "reused", "verified", "warning"].includes(event.status)) this.lastCompletedStep = event.stepId
        if (event.status !== "failed") this.failures.delete(event.stepId)
        if (["queued", "running"].includes(event.status)) {
          this.commandFailures.delete(event.stepId)
          this.attachedLogs.delete(event.stepId)
        }

        return true
      case "step.command.failed": {
        if (!this.options.failedCommandOutput || event.diagnostics.stepId !== event.stepId ||
            (!this.commandFailures.has(event.stepId) && this.commandFailures.size >= 100)) return false
        const output = failedCommandOutput(event.diagnostics, this.options.failedCommandOutput.redactValues)
        if (!output) return false
        this.check(event.stepId).status = "failed"
        this.commandFailures.set(event.stepId, output)
        return true
      }
      case "step.command.unavailable":
        if (event.stage !== "container-execution" && event.stage !== "checkpoint-ack") return false
        this.setFailure(event.stepId, `Command result unavailable (${event.stage}). Process exit unknown. No stdout or stderr was captured. External effects may already exist; reconcile this run and do not rerun automatically.`)
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
        if (Number.isFinite(timestamp) && !this.timings.has(event.stepId)) this.timings.set(event.stepId, { start: timestamp })

        return true
      case "approval.resolved":
        this.phase = event.decision === "approved" ? "running" : "failure"
        this.check(event.stepId).status = event.decision
        this.review = undefined
        if (Number.isFinite(timestamp)) {
          const timing = this.timings.get(event.stepId)
          if (timing) timing.end = timestamp
        }

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

  /** Host-owned public evidence link; never pass a signed capability or secret. */
  setResultLink(label: string, url: string): void {
    const safe = safeUrl(url)
    if (!safe || url.length > 2048 || !label.trim() || label.length > 80 || /[\r\n]/.test(label))
      throw new Error("Invalid result link")
    this.resultLink = { label, url: safe }
  }

  /** Host-sanitized diagnostic only. Never pass raw errors, logs or capability payloads. */
  setFailure(stepId: string, reason: string): void {
    if (typeof reason !== "string" || !reason.trim() || reason.length > 500) throw new Error("Invalid failure presentation")
    this.check(stepId).status = "failed"
    this.failures.set(stepId, reason.replace(/[\r\n]/g, " "))
  }

  /** Presentation only: never authorizes promotion or converts uncertainty to health.
   * Reconstruct from checkpointed observations and private image receipts on replay.
   */
  setHealth(health: RunHealth, fileId?: string): void {
    if (![10, 25, 75, 100].includes(health.phase) ||
      !["uncertain", "advance", "rollback", "regression"].includes(health.decision) ||
      !["closed-client-http-cohort", "native-wobs", "experimental-native-wobs"].includes(health.evidenceSource) ||
      (fileId !== undefined && !/^F[A-Z0-9]+$/.test(fileId))) throw new Error("Invalid health presentation")
    this.health = Object.freeze({ phase: health.phase, decision: health.decision,
      evidenceSource: health.evidenceSource, ...(health.metrics ? { metrics: copyHealthMetrics(health.metrics) } : {}),
      ...(fileId ? { fileId } : {}) })
    if (fileId) this.lastHealthChart = Object.freeze({ phase: health.phase, fileId })
  }

  snapshot(): RunSnapshot {
    const { instanceId, repository, revision, detailsUrl } = this.identity
    return Object.freeze({
      identity: Object.freeze({ instanceId, repository, revision, ...(detailsUrl ? { detailsUrl } : {}) }),
      workflowId: this.workflowId,
      phase: this.phase,
      ...(this.health ? { health: Object.freeze({ phase: this.health.phase,
        decision: this.health.decision, evidenceSource: this.health.evidenceSource,
        ...(this.health.metrics ? { metrics: this.health.metrics } : {}) }) } : {}),
      checks: Object.freeze(Array.from(this.checks, ([id, check]) => Object.freeze({
        id, status: check.status, optional: check.optional,
        dependencies: Object.freeze(Array.from(check.dependencies)),
        ...(this.failures.has(id) ? { failureReason: this.failures.get(id)! } : {}),
      }))),
    })
  }

  /** A native table in the first thread reply, never a capability or raw payload. */
  renderDetails(stepLinks: ReadonlyMap<string, string> = new Map()): { text: string; blocks: ReadonlyArray<SlackBlock> } {
    const cell = (text: string, url?: string) => url ? { type: "rich_text", elements: [{ type: "rich_text_section",
      elements: [{ type: "link", url, text: text.slice(0, 80) }] }] } : { type: "raw_text", text: text.slice(0, 80) }
    const ids = [...new Set([...(this.progressSteps ?? []), ...this.checks.keys()])]
    if (!ids.length) return { text: "Preparing steps…", blocks: [
      { type: "section", text: { type: "plain_text", text: "Preparing steps…" } },
    ] }
    // One table per message, at most 100 rows including its header. Preserve
    // full textual status for screen readers; glyphs are visual shorthand only.
    const rows = ids.slice(0, 99).map(id => ({ id, status: this.checks.get(id)?.status ?? "planned" }))
    const time = (id: string, status: keyof typeof plainSymbols) => {
      if (status === "reused" || status === "verified") return "(cached)"
      const timing = this.timings.get(id)
      if (!timing) return "—"
      const seconds = Math.max(0, Math.round(((timing.end ?? this.latestTimestamp) - timing.start) / 1000))
      return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    }
    return { text: rows.map(({ id, status }) => `${id}: ${status}`).join("\n"), blocks: [
      { type: "table", column_settings: [{ is_wrapped: true }, { is_wrapped: false }, { is_wrapped: false }],
        rows: [[cell("Step"), cell("Status"), cell("Time")], ...rows.map(({ id, status }) => [
          cell(id, safeUrl(stepLinks.get(id))), cell(plainSymbols[status]), cell(time(id, status)),
        ])] },
      ...(ids.length > 99 ? [{ type: "context", elements: [{ type: "plain_text", text: `${ids.length - 99} more steps; see Dashboard.` }] }] : []),
    ] }
  }

  render(options: { hideSkipped?: boolean; rollbackStep?: string; minimal?: boolean; currentStep?: string; statusOnly?: boolean; onlyStep?: string } = {}): { text: string; blocks: ReadonlyArray<SlackBlock> } {
    const ordered: Array<string> = []
    const visited = new Set<string>()
    const visit = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)
      for (const dependency of this.checks.get(id)?.dependencies ?? []) visit(dependency)
      if (this.checks.has(id)) ordered.push(id)
    }
    for (const id of this.checks.keys()) visit(id)

    const restored = Boolean(options.rollbackStep && (this.phase === "success" || this.phase === "failure") &&
      this.checks.get(options.rollbackStep)?.status === "complete")
    const headline = restored ? this.phase === "failure" ? "↩️ Rolled back" : "↩️ Previous version restored" :
      { running: "▶️ Running", waiting: "⏳ Waiting for approval", success: "✅ Passed", failure: "❌ Failed" }[this.phase]
    if (options.statusOnly) {
      const current = (this.phase === "success" ? this.lastCompletedStep : undefined) ?? ordered.find(id => this.checks.get(id)!.status === "waiting") ??
        ordered.find(id => ["failed", "rejected"].includes(this.checks.get(id)!.status)) ??
        ordered.find(id => this.checks.get(id)!.status === "running") ??
        ordered.find(id => ["queued", "planned"].includes(this.checks.get(id)!.status)) ?? ordered.at(-1)
      const done = ordered.filter(id => finished.has(this.checks.get(id)!.status)).length
      // A host-declared step total is a presentation contract, not a forecast.
      // If execution discovers another step, stop claiming that total.
      const total = this.progressSteps?.length && ordered.every(id => this.progressSteps!.includes(id)) ? this.progressSteps.length : undefined
      const count = total ? `${"▰".repeat(done)}${"▱".repeat(total - done)} ${done}/${total}` :
        done ? `${done} step${done === 1 ? "" : "s"} done` : undefined
      const symbol = { running: "►", waiting: "∗", success: "✓", failure: "✗" }[this.phase]
      const title = `${symbol} ${this.workflowId.slice(0, 70)}${current ? ` · ${current.slice(0, 100)}` : " · Preparing"}${this.phase === "waiting" ? " · Awaiting review" : ""}${restored ? " · Restored" : ""}${count ? ` · ${count}` : ""}`.replace(/[\r\n]/g, " ")
      return { text: title, blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${escape(title)}*`, verbatim: true } },
        { type: "context", elements: [{ type: "mrkdwn", text: sourceLinks(this.identity) + (this.resultLink ? ` • ${link(this.resultLink.url, this.resultLink.label.replace(/^Open /, "").replace(/^preview$/, "Preview").replace(/^checked build$/, "Checked build"))}` : ""), verbatim: true }] },
        // Latest evidence remains visible without opening the thread, including
        // after terminal success/failure. Approval capabilities stay in replies.
        ...(this.lastHealthChart ? [{ type: "image", slack_file: { id: this.lastHealthChart.fileId }, alt_text: `Latest successfully rendered health confidence intervals: Release ${this.lastHealthChart.phase}%; not a forecast` }] : []),
        ...(this.health && !this.health.fileId ? [{ type: "section", text: { type: "plain_text", text: `Release ${this.health.phase}% · ${this.health.decision} · chart unavailable${this.lastHealthChart ? `; last chart: ${this.lastHealthChart.phase}%` : ""}` } }] : []),
      ] }
    }
    if (options.minimal) {
      const current = options.currentStep ?? ordered.find(id => this.checks.get(id)!.status === "waiting") ??
        ordered.find(id => this.checks.get(id)!.status === "running") ??
        ordered.find(id => this.checks.get(id)!.status === "failed") ??
        ordered.find(id => ["queued", "planned"].includes(this.checks.get(id)!.status)) ?? ordered.at(-1)
      const title = restored ? `${headline}${this.phase === "failure" && current ? ` · ${current}` : ""}` :
        this.phase === "success" ? headline : `${headline}${current ? ` · ${current}` : ""}`
      // Reuse the existing capability/button builder, but never carry its checklist,
      // diagnostics, metric text or image into the continuously updated root card.
      const full = this.render({ ...options, minimal: false })
      const actions = full.blocks.filter(block => block.type === "actions")
      return { text: title, blocks: [
        { type: "header", text: { type: "plain_text", text: title.slice(0, 150) } },
        { type: "context", elements: [{ type: "mrkdwn", text: sourceLinks(this.identity), verbatim: true }] },
        ...(this.review ? [{ type: "section", text: { type: "plain_text", text: this.review.request.summary.slice(0, 1000) } }] : []),
        ...actions,
      ] }
    }
    const lines = ordered.filter(id => (!options.onlyStep || id === options.onlyStep) && (!options.hideSkipped || this.checks.get(id)!.status !== "skipped")).map((id, index) => {
      const check = this.checks.get(id)!

      return `${options.onlyStep ? "" : `${index + 1}. `}${restored && id === options.rollbackStep ? "↩️" : (options.onlyStep ? plainSymbols : symbols)[check.status]} ${id}${check.status === "complete" ? "" : ` — ${check.status}`}${check.optional ? " (optional)" : ""}${this.failures.has(id) ? `\n   > ${this.failures.get(id)}` : ""}`
    })
    const blocks: Array<SlackBlock> = options.onlyStep ? [] : [
      { type: "header", text: { type: "plain_text", text: `${headline} · ${this.workflowId}`.slice(0, 150) } },
      { type: "context", elements: [{ type: "mrkdwn", text: sourceLinks(this.identity), verbatim: true }] },
      { type: "divider" },
    ]
    // One compact checklist, split into sections to respect Slack's text limit.
    let section = ""
    for (const line of lines.slice(0, 100)) {
      const safe = escape(line).replaceAll("\n   &gt; ", "\n   > ").slice(0, 1100)
      if (section.length + safe.length > 2800) {
        blocks.push({ type: "section", text: { type: "mrkdwn", text: section, verbatim: true } })
        section = ""
      }
      section += `${safe}\n`
    }
    blocks.push({ type: "section", text: { type: "mrkdwn", text: section || "Preparing checks…", verbatim: true } })
    const output = options.onlyStep ? this.commandFailures.get(options.onlyStep) : undefined
    const commandFailure = output && options.onlyStep && this.attachedLogs.has(options.onlyStep) ? output.compact : output
    if (commandFailure) blocks.push(...commandFailure.blocks)
    if (lines.length > 100) blocks.push({ type: "context", elements: [{ type: "plain_text", text: `${lines.length - 100} more checks; see Workflow history.` }] })
    if (this.health) {
      const evidence = this.health.evidenceSource === "experimental-native-wobs" ? "Native Worker outcomes (experimental SQL)" :
        this.health.evidenceSource === "native-wobs" ? "Native WOBS" : "HTTP cohort (not WOBS)"
      if (!this.health.fileId) blocks.push({ type: "section", text: { type: "plain_text", text: `Release ${this.health.phase}% · ${this.health.decision} · ${evidence} · chart unavailable` } })
      if (this.health.fileId) blocks.push({ type: "image", slack_file: { id: this.health.fileId }, alt_text: "Observed health confidence intervals; not a forecast" })
    }
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
    const health = this.health ? `\nRelease ${this.health.phase}% · ${this.health.decision} · ${this.health.evidenceSource}` : ""

    return { text: options.onlyStep ? `${lines.join("\n")}${commandFailure ? `\n${escape(commandFailure.text)}` : ""}${health}${review}` : `${headline} · ${this.workflowId}\n${lines.join("\n")}${health}${review}\nRun: ${this.identity.instanceId}`, blocks }
  }
}
