import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { Readable } from "node:stream"
import type { PlanNode, WorkflowEvent } from "@effect-ci-testbed/ci"
import {
  createCheck,
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

const statuses = new Map<string, PlanNode["status"]>()
const dependencies = new Map<string, Set<string>>()
let workflowId = workflow
let checkId: number | undefined
let checkUrl: string | undefined
let completed = false

const statusLabel: Record<PlanNode["status"], string> = {
  planned: "◌ planned",
  queued: "○ queued",
  running: "🟡 running",
  complete: "✅ success",
  failed: "❌ failure",
  skipped: "⏭️ skipped",
}

const orderedSteps = (): ReadonlyArray<string> => {
  const ordered: Array<string> = []
  const visited = new Set<string>()
  const visit = (stepId: string) => {
    if (visited.has(stepId)) return
    visited.add(stepId)
    for (const dependency of [...(dependencies.get(stepId) ?? [])].sort()) {
      visit(dependency)
    }
    if (statuses.has(stepId)) ordered.push(stepId)
  }

  for (const stepId of [...statuses.keys()].sort()) visit(stepId)
  return ordered
}

const summary = (): string => {
  const rows = orderedSteps()
    .map((stepId) => `| ${stepId} | ${statusLabel[statuses.get(stepId)!]} |`)
    .join("\n")

  return rows
    ? `| Step | Status |\n| --- | --- |\n${rows}`
    : "Waiting for workflow steps…"
}

const ensureCheck = async () => {
  if (checkId !== undefined) return

  const check = await createCheck({
    token,
    repository,
    sha,
    name: `Effect CI / ${workflowId}`,
    title: `${workflowId} is running`,
    summary: summary(),
    status: "in_progress",
    ...(detailsUrl ? { detailsUrl } : {}),
    ...(externalId ? { externalId } : {}),
  })
  checkId = check.id
  checkUrl = check.htmlUrl
  console.log(`Effect CI check: ${check.htmlUrl}`)
}

const publish = async (
  title: string,
  conclusion?: CheckConclusion,
) => {
  await ensureCheck()
  await updateCheck({
    token,
    repository,
    checkId: checkId!,
    title,
    summary: summary(),
    ...(conclusion ? { conclusion } : { status: "in_progress" }),
  })
}

const report = async (event: WorkflowEvent) => {
  switch (event.type) {
    case "workflow.started":
      workflowId = event.workflowId
      await publish(`${workflowId} is running`)
      return
    case "dependency.added": {
      const needs = dependencies.get(event.stepId) ?? new Set<string>()
      needs.add(event.needs)
      dependencies.set(event.stepId, needs)
      await publish(`${workflowId} is running`)
      return
    }
    case "step.status":
      statuses.set(event.stepId, event.status)
      await publish(`${workflowId} is running`)
      return
    case "workflow.completed":
      completed = true
      await publish(
        event.conclusion === "success"
          ? `${workflowId} passed`
          : `${workflowId} failed`,
        event.conclusion,
      )
  }
}

const child = spawn("pnpm", ["exec", "tsx", workflow], {
  env: { ...process.env, EFFECT_CI_EVENT_FD: "3" },
  stdio: ["inherit", "inherit", "inherit", "pipe"],
})

const eventStream = child.stdio[3] as Readable | null
if (!eventStream) throw new Error("Effect CI event stream is unavailable")

let reportingError: unknown
const reporting = (async () => {
  const lines = createInterface({ input: eventStream })
  for await (const line of lines) {
    await report(JSON.parse(line) as WorkflowEvent)
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
  await publish(`${workflowId} failed`, "failure")
}

if (reportingError) throw reportingError
if (exitCode !== 0) throw new Error(`Effect CI exited with code ${exitCode}`)

console.log(`Effect CI completed: ${checkUrl}`)
