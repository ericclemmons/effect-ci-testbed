import { formatCondition, type PlanNode, type RuntimeEvent, type WorkflowPlan } from "@effect-ci-testbed/ci"
import {
  createCheck,
  updateCheck,
  type CheckRun,
  type CreateCheckOptions,
  type CheckConclusion,
  type UpdateCheckOptions,
} from "./index.js"

export interface ReporterOptions {
  readonly detailsUrl?: string
  readonly externalId?: string
  readonly repository: string
  readonly sha: string
  readonly summaryCheckId?: number
  readonly token: string
}

export interface ReporterClient {
  readonly createCheck: (options: CreateCheckOptions) => Promise<CheckRun>
  readonly updateCheck: (options: UpdateCheckOptions) => Promise<CheckRun>
}

interface StepCheck {
  readonly id: number
  readonly htmlUrl: string
  optional: boolean
  status: PlanNode["status"]
}

const MAX_OUTPUT_LENGTH = 60_000

const branchSuffix = (index: number): string => {
  let value = index + 1
  let suffix = ""

  while (value > 0) {
    value -= 1
    suffix = String.fromCharCode(97 + (value % 26)) + suffix
    value = Math.floor(value / 26)
  }

  return suffix
}

const planStages = (value: WorkflowPlan) => {
  const stages = new Map<string, number>()

  for (const node of value.nodes) {
    stages.set(
      node.id,
      1 + Math.max(
        0,
        ...[
          ...node.needs,
          ...node.after,
          ...(node.compensationFor ? [node.compensationFor] : []),
        ]
          .map((dependency) => stages.get(dependency) ?? 0),
      ),
    )
  }

  const groups = new Map<number, Array<PlanNode>>()

  for (const node of value.nodes) {
    const stage = stages.get(node.id) ?? 1
    groups.set(stage, [...(groups.get(stage) ?? []), node])
  }

  return groups
}

const mermaidLabel = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")

const planDiagram = (value: WorkflowPlan): string => {
  const identifiers = new Map(
    value.nodes.map((node, index) => [node.id, `step${index}`] as const),
  )
  const lines = ["flowchart LR"]

  for (const node of value.nodes) {
    lines.push(`  ${identifiers.get(node.id)}["${mermaidLabel(node.id)}${node.optional ? " (optional)" : ""}"]`)
  }

  for (const node of value.nodes) {
    for (const dependency of node.needs) {
      const from = identifiers.get(dependency)
      const to = identifiers.get(node.id)
      if (from && to) lines.push(`  ${from} --> ${to}`)
    }

    for (const dependency of node.after) {
      const from = identifiers.get(dependency)
      const to = identifiers.get(node.id)
      if (from && to) lines.push(`  ${from} -. after .-> ${to}`)
    }

    if (node.compensationFor) {
      const from = identifiers.get(node.compensationFor)
      const to = identifiers.get(node.id)
      if (from && to) lines.push(`  ${from} -. on failure .-> ${to}`)
    }
  }

  return lines.join("\n")
}

const planSummary = (value: WorkflowPlan): string => {
  const groups = planStages(value)
  const lines = [
    "### Execution graph",
    "",
    "```mermaid",
    planDiagram(value),
    "```",
    "",
    "<details>",
    "<summary>Text view</summary>",
    "",
  ]

  for (const [stage, nodes] of groups) {
    const ordered = [...nodes].sort((left, right) => left.id.localeCompare(right.id))

    if (ordered.length === 1) {
      const node = ordered[0]!
      const needs = node.needs.length > 0
        ? ` — needs ${node.needs.map((id) => `\`${id}\``).join(", ")}`
        : ""
      const after = node.after.length > 0
        ? ` — after ${node.after.map((id) => `\`${id}\``).join(", ")}`
        : ""
      const optional = node.optional ? " — **optional**" : ""
      const condition = node.condition ? ` — if \`${formatCondition(node.condition)}\`` : ""
      const compensation = node.compensationFor
        ? ` — compensates \`${node.compensationFor}\``
        : ""
      lines.push(`${stage}. \`${node.id}\`${needs}${after}${condition}${compensation}${optional}`)
      continue
    }

    lines.push(`${stage}. **In parallel**`)

    for (const [index, node] of ordered.entries()) {
      const needs = node.needs.length > 0
        ? ` — needs ${node.needs.map((id) => `\`${id}\``).join(", ")}`
        : ""
      const after = node.after.length > 0
        ? ` — after ${node.after.map((id) => `\`${id}\``).join(", ")}`
        : ""
      const optional = node.optional ? " — **optional**" : ""
      const condition = node.condition ? ` — if \`${formatCondition(node.condition)}\`` : ""
      const compensation = node.compensationFor
        ? ` — compensates \`${node.compensationFor}\``
        : ""
      lines.push(`   - ${stage}${branchSuffix(index)}. \`${node.id}\`${needs}${after}${condition}${compensation}${optional}`)
    }
  }

  lines.push("", "</details>")

  return lines.join("\n")
}

const planText = (value: WorkflowPlan): string => value.nodes
  .filter((node) =>
    node.commands.length > 0 || node.approval || node.artifacts.length > 0 ||
    node.secrets.length > 0 || node.condition || node.compensationFor)
  .map((node) => {
    const commands = node.commands
      .map((entry) => `$ ${entry.command}\n# cwd: ${entry.cwd}`)
      .join("\n\n")
    const approval = node.approval
      ? `**Approval:** ${node.approval.title}\n\n${node.approval.summary}`
      : ""
    const metadata = [
      node.condition ? `**Condition:** \`${formatCondition(node.condition)}\`` : "",
      node.compensationFor ? `**Compensates:** \`${node.compensationFor}\`` : "",
      node.secrets.length > 0 ? `**Secrets required:** ${node.secrets.map((name) => `\`${name}\``).join(", ")}` : "",
      ...node.artifacts.map((artifact) =>
        `**Artifact ${artifact.direction}:** \`${artifact.name}\` (${artifact.paths.map((path) => `\`${path}\``).join(", ")})`),
    ].filter(Boolean).join("\n\n")
    const details = [approval, metadata, commands ? `\`\`\`sh\n${commands}\n\`\`\`` : ""]
      .filter(Boolean)
      .join("\n\n")

    return `#### ${node.id}${node.optional ? " (optional)" : ""}\n\n${details}`
  })
  .join("\n\n")

const checkOutput = (
  workflowId: string,
  stepId: string,
  status: PlanNode["status"],
  optional: boolean,
): {
  readonly conclusion?: CheckConclusion
  readonly status?: "queued" | "in_progress"
  readonly summary: string
  readonly title: string
} => {
  switch (status) {
    case "planned":
    case "queued":
      return {
        title: `${stepId} is queued`,
        summary: `Waiting to run as ${optional ? "an optional" : "a required"} part of ${workflowId}.`,
        status: "queued",
      }
    case "running":
      return {
        title: `${stepId} is running`,
        summary: `Running as part of ${workflowId}.`,
        status: "in_progress",
      }
    case "complete":
      return {
        title: `${stepId} passed`,
        summary: `Completed successfully as part of ${workflowId}.`,
        conclusion: "success",
      }
    case "reused":
      return {
        title: `${stepId} was reused`,
        summary: `Reused from an unaffected earlier attempt of ${workflowId}.`,
        conclusion: "success",
      }
    case "verified":
      return {
        title: `${stepId} was already verified`,
        summary: `Trusted signed evidence matched this exact revision and action in ${workflowId}.`,
        conclusion: "success",
      }
    case "warning":
      return {
        title: `${stepId} completed with a warning`,
        summary: `This optional check failed without blocking ${workflowId}.`,
        conclusion: "neutral",
      }
    case "failed":
      return {
        title: `${stepId} failed`,
        summary: `Failed while running as part of ${workflowId}.`,
        conclusion: "failure",
      }
    case "skipped":
      return {
        title: `${stepId} was skipped`,
        summary: `Skipped because a dependency in ${workflowId} failed.`,
        conclusion: "skipped",
      }
  }
}

export class Reporter {
  private readonly checks = new Map<string, StepCheck>()
  private readonly output = new Map<string, string>()
  private completed = false
  private mode: WorkflowPlan["mode"] = "execute"
  private plan: WorkflowPlan | undefined
  private workflowId = "effect-ci"

  private readonly client: ReporterClient

  constructor(
    private readonly options: ReporterOptions,
    client: ReporterClient = { createCheck, updateCheck },
  ) {
    this.client = client
  }

  get isComplete(): boolean {
    return this.completed
  }

  get size(): number {
    return this.checks.size
  }

  private appendOutput(stepId: string, stream: "stdout" | "stderr", text: string) {
    const prefix = stream === "stderr" ? "[stderr] " : ""
    const next = `${this.output.get(stepId) ?? ""}${prefix}${text}`

    this.output.set(
      stepId,
      next.length > MAX_OUTPUT_LENGTH
        ? `[output truncated]\n${next.slice(-MAX_OUTPUT_LENGTH)}`
        : next,
    )
  }

  private outputText(stepId: string): string | undefined {
    const text = this.output.get(stepId)?.trimEnd()
    return text ? `#### Command output\n\n\`\`\`text\n${text}\n\`\`\`` : undefined
  }

  private async publishStep(
    stepId: string,
    status: PlanNode["status"],
    name = `${this.workflowId} / ${stepId}`,
    optional = false,
  ) {
    const output = checkOutput(this.workflowId, stepId, status, optional)
    const text = this.outputText(stepId)
    const existing = this.checks.get(stepId)

    if (!existing) {
      const check = await this.client.createCheck({
        ...this.options,
        name,
        title: output.title,
        summary: output.summary,
        ...(text ? { text } : {}),
        ...(output.status ? { status: output.status } : {}),
        ...(output.conclusion ? { conclusion: output.conclusion } : {}),
        ...(this.options.externalId
          ? { externalId: `${this.options.externalId}:${stepId}` }
          : {}),
      })

      this.checks.set(stepId, {
        id: check.id,
        htmlUrl: check.htmlUrl,
        status,
        optional,
      })
      return
    }

    await this.client.updateCheck({
      token: this.options.token,
      repository: this.options.repository,
      checkId: existing.id,
      name,
      title: output.title,
      summary: output.summary,
      ...(text ? { text } : {}),
      ...(output.status ? { status: output.status } : {}),
      ...(output.conclusion ? { conclusion: output.conclusion } : {}),
    })
    existing.status = status
    existing.optional = optional
  }

  private stepCheckNames(value: WorkflowPlan): ReadonlyMap<string, string> {
    const groups = planStages(value)
    const width = String(Math.max(0, ...groups.keys())).length
    const names = new Map<string, string>()

    for (const [stage, nodes] of groups) {
      const prefix = String(stage).padStart(width, "0")
      const stepIds = nodes.map((node) => node.id)

      for (const [index, stepId] of [...stepIds].sort().entries()) {
        const ordinal = stepIds.length > 1 ? `${prefix}${branchSuffix(index)}` : prefix
        const node = nodes.find((candidate) => candidate.id === stepId)
        names.set(stepId, `${this.workflowId} / ${ordinal}. ${stepId}${node?.optional ? " (optional)" : ""}`)
      }
    }

    return names
  }

  private async updateSummary(
    status: "in_progress" | "completed",
    conclusion?: "success" | "failure",
  ) {
    if (!this.options.summaryCheckId) return

    await this.client.updateCheck({
      token: this.options.token,
      repository: this.options.repository,
      checkId: this.options.summaryCheckId,
      name: `${this.workflowId} / Cloudflare`,
      title: conclusion
        ? `${this.workflowId} ${conclusion === "success" ? "passed" : "failed"} on Cloudflare`
        : `${this.workflowId} is running on Cloudflare`,
      summary: conclusion
        ? `The native Cloudflare Workflow completed with ${conclusion}.`
        : "A native Cloudflare Workflow is executing this commit.",
      status,
      ...(conclusion ? { conclusion } : {}),
    })
  }

  async report(event: RuntimeEvent): Promise<void> {
    switch (event.type) {
      case "approval.requested":
      case "approval.resolved":
      case "dependency.added":
        return
      case "workflow.started":
        this.workflowId = event.workflowId
        this.mode = event.mode
        await this.updateSummary("in_progress")
        return
      case "step.status":
        if (this.mode === "execute") {
          await this.publishStep(event.stepId, event.status, undefined, event.optional)
        }
        return
      case "step.output":
        this.appendOutput(event.stepId, event.stream, event.text)
        return
      case "workflow.plan": {
        this.plan = event.plan

        if (this.mode === "execute") {
          const names = this.stepCheckNames(event.plan)

          for (const node of event.plan.nodes) {
            await this.publishStep(node.id, node.status, names.get(node.id), node.optional)
          }
        }
        return
      }
      case "workflow.completed":
        if (this.mode === "plan" && this.plan) {
          const text = planText(this.plan)
          const check = await this.client.createCheck({
            ...this.options,
            name: `${this.workflowId} / 0. plan`,
            title: event.conclusion === "success"
              ? `${this.workflowId} plan ready`
              : `${this.workflowId} plan failed`,
            summary: planSummary(this.plan),
            ...(text ? { text } : {}),
            conclusion: event.conclusion,
            ...(this.options.externalId
              ? { externalId: `${this.options.externalId}:plan` }
              : {}),
          })

          this.checks.set("plan", {
            id: check.id,
            htmlUrl: check.htmlUrl,
            status: event.conclusion === "success" ? "complete" : "failed",
            optional: false,
          })
        }

        await this.updateSummary("completed", event.conclusion)
        this.completed = true
        return
    }
  }

  async abort(): Promise<void> {
    if (this.completed) return

    if (this.checks.size === 0) {
      await this.publishStep("startup", "failed")
    } else {
      for (const [stepId, check] of this.checks) {
        if (check.status === "queued" || check.status === "running") {
          await this.publishStep(
            stepId,
            check.status === "running" ? "failed" : "skipped",
            undefined,
            check.optional,
          )
        }
      }
    }

    await this.updateSummary("completed", "failure")
  }
}
