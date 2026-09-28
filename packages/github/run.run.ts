import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { Readable } from "node:stream"
import type { Writable } from "node:stream"
import { fileURLToPath } from "node:url"
import type { PlanNode, RuntimeEvent, WorkflowPlan } from "@effect-ci-testbed/ci"
import {
  createCheck,
  getCheck,
  updateCheck,
  type CheckConclusion,
} from "@effect-ci-testbed/github"

const required = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

const token = required("GITHUB_TOKEN")
const repository = required("GITHUB_REPOSITORY")
const sha = required("EFFECT_CI_SHA")
const workflow = required("EFFECT_CI_WORKFLOW")
const detailsUrl = process.env.EFFECT_CI_DETAILS_URL
const externalId = process.env.EFFECT_CI_EXTERNAL_ID

interface StepCheck {
  readonly id: number
  readonly htmlUrl: string
  status: PlanNode["status"]
  optional: boolean
}

const checks = new Map<string, StepCheck>()
const output = new Map<string, string>()
const approvalSteps = new Set<string>()
let workflowId = workflow
let mode: WorkflowPlan["mode"] = "execute"
let plan: WorkflowPlan | undefined
let completed = false

const MAX_OUTPUT_LENGTH = 60_000
const APPROVAL_POLL_INTERVAL_MS = 3_000
const APPROVAL_TIMEOUT_MS = Number(process.env.EFFECT_CI_APPROVAL_TIMEOUT_MS ?? 1_800_000)

const appendOutput = (stepId: string, stream: "stdout" | "stderr", text: string) => {
  const prefix = stream === "stderr" ? "[stderr] " : ""
  const next = `${output.get(stepId) ?? ""}${prefix}${text}`
  output.set(
    stepId,
    next.length > MAX_OUTPUT_LENGTH
      ? `[output truncated]\n${next.slice(-MAX_OUTPUT_LENGTH)}`
      : next,
  )
}

const outputText = (stepId: string): string | undefined => {
  const text = output.get(stepId)?.trimEnd()
  return text ? `#### Command output\n\n\`\`\`text\n${text}\n\`\`\`` : undefined
}

const checkOutput = (stepId: string, status: PlanNode["status"], optional: boolean): {
  readonly title: string
  readonly summary: string
  readonly status?: "queued" | "in_progress"
  readonly conclusion?: CheckConclusion
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

const publishStep = async (
  stepId: string,
  status: PlanNode["status"],
  name = `${workflowId} / ${stepId}`,
  optional = false,
) => {
  const output = checkOutput(stepId, status, optional)
  const text = outputText(stepId)
  const existing = checks.get(stepId)

  if (!existing) {
    const check = await createCheck({
      token,
      repository,
      sha,
      name,
      title: output.title,
      summary: output.summary,
      ...(text ? { text } : {}),
      ...(output.status ? { status: output.status } : {}),
      ...(output.conclusion ? { conclusion: output.conclusion } : {}),
      ...(detailsUrl ? { detailsUrl } : {}),
      ...(externalId ? { externalId: `${externalId}:${stepId}` } : {}),
    })
    checks.set(stepId, { id: check.id, htmlUrl: check.htmlUrl, status, optional })
    console.log(`Effect CI check (${stepId}): ${check.htmlUrl}`)
    return
  }

  await updateCheck({
    token,
    repository,
    checkId: existing.id,
    name,
    title: output.title,
    summary: output.summary,
    ...(text ? { text } : {}),
    ...(output.status ? { status: output.status } : {}),
    ...(output.conclusion ? { conclusion: output.conclusion } : {}),
    actions: [],
  })
  existing.status = status
  existing.optional = optional
}

const planText = (value: WorkflowPlan): string => value.nodes
  .filter((node) => node.commands.length > 0 || node.approval)
  .map((node) => {
    const commands = node.commands
      .map((entry) => `$ ${entry.command}\n# cwd: ${entry.cwd}`)
      .join("\n\n")
    const approval = node.approval
      ? `**Approval:** ${node.approval.title}\n\n${node.approval.summary}`
      : ""
    const details = [approval, commands ? `\`\`\`sh\n${commands}\n\`\`\`` : ""]
      .filter(Boolean)
      .join("\n\n")
    return `#### ${node.id}${node.optional ? " (optional)" : ""}\n\n${details}`
  })
  .join("\n\n")

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
        ...[...node.needs, ...node.after]
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
      lines.push(`${stage}. \`${node.id}\`${needs}${after}${optional}`)
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
      lines.push(`   - ${stage}${branchSuffix(index)}. \`${node.id}\`${needs}${after}${optional}`)
    }
  }
  lines.push("", "</details>")
  return lines.join("\n")
}

const stepCheckNames = (value: WorkflowPlan): ReadonlyMap<string, string> => {
  const groups = planStages(value)

  const width = String(Math.max(0, ...groups.keys())).length
  const names = new Map<string, string>()
  for (const [stage, nodes] of groups) {
    const prefix = String(stage).padStart(width, "0")
    const stepIds = nodes.map((node) => node.id)
    for (const [index, stepId] of [...stepIds].sort().entries()) {
      const ordinal = stepIds.length > 1 ? `${prefix}${branchSuffix(index)}` : prefix
      const node = nodes.find((candidate) => candidate.id === stepId)
      names.set(stepId, `${workflowId} / ${ordinal}. ${stepId}${node?.optional ? " (optional)" : ""}`)
    }
  }
  return names
}

const publishPlan = async (
  value: WorkflowPlan,
  conclusion: "success" | "failure",
) => {
  const text = planText(value)
  const check = await createCheck({
    token,
    repository,
    sha,
    name: `${workflowId} / 0. plan`,
    title: conclusion === "success" ? `${workflowId} plan ready` : `${workflowId} plan failed`,
    summary: planSummary(value),
    ...(text ? { text } : {}),
    conclusion,
    ...(detailsUrl ? { detailsUrl } : {}),
    ...(externalId ? { externalId: `${externalId}:plan` } : {}),
  })
  checks.set("plan", {
    id: check.id,
    htmlUrl: check.htmlUrl,
    status: conclusion === "success" ? "complete" : "failed",
    optional: false,
  })
  console.log(`Effect CI check (plan): ${check.htmlUrl}`)
}

const waitForApproval = async (
  event: Extract<RuntimeEvent, { readonly type: "approval.requested" }>,
) => {
  approvalSteps.add(event.stepId)
  const existing = checks.get(event.stepId)
  if (!existing) throw new Error(`Missing approval check for ${event.stepId}`)

  await updateCheck({
    token,
    repository,
    checkId: existing.id,
    title: event.approval.title,
    summary: event.approval.summary,
    conclusion: "action_required",
    actions: [
      {
        label: event.approval.approveLabel ?? "Approve",
        description: "Approve and continue this workflow",
        identifier: "approve",
      },
      {
        label: event.approval.rejectLabel ?? "Reject",
        description: "Reject and stop this workflow",
        identifier: "reject",
      },
    ],
  })

  const deadline = Date.now() + APPROVAL_TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, APPROVAL_POLL_INTERVAL_MS))
    const check = await getCheck(token, repository, existing.id)

    if (check.status !== "completed" || check.conclusion === "action_required") {
      continue
    }

    const actor = check.summary?.match(/by @([^\.]+)\./)?.[1]

    return {
      decision: check.conclusion === "success" ? "approved" as const : "rejected" as const,
      ...(actor ? { actor } : {}),
    }
  }

  await updateCheck({
    token,
    repository,
    checkId: existing.id,
    title: `${event.stepId} timed out`,
    summary: "No approval decision was received before the timeout.",
    conclusion: "timed_out",
    actions: [],
  })

  return { decision: "rejected" as const }
}

let controlStream: Writable | undefined

const resolveApproval = async (
  event: Extract<RuntimeEvent, { readonly type: "approval.requested" }>,
) => {
  if (!controlStream) throw new Error("Effect CI approval control stream is unavailable")
  const result = await waitForApproval(event)

  controlStream.write(`${JSON.stringify({
    type: "approval.resolved",
    requestId: event.requestId,
    decision: result.decision,
    ...(result.actor ? { actor: result.actor } : {}),
  })}\n`)
}

const report = async (event: RuntimeEvent) => {
  switch (event.type) {
    case "approval.requested":
      await resolveApproval(event)
      return
    case "approval.resolved":
      return
    case "workflow.started":
      workflowId = event.workflowId
      mode = event.mode
      return
    case "dependency.added":
      return
    case "step.status":
      if (
        mode === "execute" &&
        !(approvalSteps.has(event.stepId) && (event.status === "complete" || event.status === "failed"))
      ) {
        await publishStep(event.stepId, event.status, undefined, event.optional)
      }
      return
    case "step.output":
      appendOutput(event.stepId, event.stream, event.text)
      return
    case "workflow.plan":
      plan = event.plan
      if (mode === "execute") {
        const names = stepCheckNames(event.plan)
        for (const node of event.plan.nodes) {
          await publishStep(node.id, node.status, names.get(node.id), node.optional)
        }
      }
      return
    case "workflow.completed":
      if (mode === "plan" && plan) await publishPlan(plan, event.conclusion)
      completed = true
      return
  }
}

const runtime = fileURLToPath(new URL("../ci/run.run.ts", import.meta.url))
const child = spawn(process.execPath, ["--import", "tsx", runtime], {
  env: {
    ...process.env,
    EFFECT_CI_EVENT_FD: "3",
    EFFECT_CI_CONTROL_FD: "4",
  },
  stdio: ["inherit", "inherit", "inherit", "pipe", "pipe"],
})

const eventStream = child.stdio[3] as Readable | null
if (!eventStream) throw new Error("Effect CI event stream is unavailable")
controlStream = (child.stdio[4] as Writable | null) ?? undefined

let reportingError: unknown
const reporting = (async () => {
  const lines = createInterface({ input: eventStream })
  for await (const line of lines) {
    await report(JSON.parse(line) as RuntimeEvent)
  }
})().catch((error: unknown) => {
  reportingError = error
  child.kill("SIGTERM")
})

const exitCode = await new Promise<number>((resolve, reject) => {
  child.once("error", reject)
  child.once("exit", (code) => resolve(code ?? 1))
})
await reporting

if (!completed) {
  if (exitCode === 0 && checks.size === 0) {
    console.log("Effect CI workflow ignored this event")
  } else if (checks.size === 0) {
    await publishStep("startup", "failed")
  } else {
    for (const [stepId, check] of checks) {
      if (check.status === "queued" || check.status === "running") {
        await publishStep(stepId, check.status === "running" ? "failed" : "skipped", undefined, check.optional)
      }
    }
  }
}

if (reportingError) throw reportingError
if (exitCode !== 0) throw new Error(`Effect CI exited with code ${exitCode}`)

console.log(`Effect CI completed with ${checks.size} checks`)
