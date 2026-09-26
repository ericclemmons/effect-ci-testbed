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

interface StepCheck {
  readonly id: number
  readonly htmlUrl: string
  status: PlanNode["status"]
}

const checks = new Map<string, StepCheck>()
let workflowId = workflow
let completed = false

const checkOutput = (stepId: string, status: PlanNode["status"]): {
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
        summary: `Waiting to run as part of ${workflowId}.`,
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

const publishStep = async (stepId: string, status: PlanNode["status"]) => {
  const output = checkOutput(stepId, status)
  const existing = checks.get(stepId)

  if (!existing) {
    const check = await createCheck({
      token,
      repository,
      sha,
      name: `${workflowId} / ${stepId}`,
      title: output.title,
      summary: output.summary,
      ...(output.status ? { status: output.status } : {}),
      ...(output.conclusion ? { conclusion: output.conclusion } : {}),
      ...(detailsUrl ? { detailsUrl } : {}),
      ...(externalId ? { externalId: `${externalId}:${stepId}` } : {}),
    })
    checks.set(stepId, { id: check.id, htmlUrl: check.htmlUrl, status })
    console.log(`Effect CI check (${stepId}): ${check.htmlUrl}`)
    return
  }

  await updateCheck({
    token,
    repository,
    checkId: existing.id,
    title: output.title,
    summary: output.summary,
    ...(output.status ? { status: output.status } : {}),
    ...(output.conclusion ? { conclusion: output.conclusion } : {}),
  })
  existing.status = status
}

const report = async (event: WorkflowEvent) => {
  switch (event.type) {
    case "workflow.started":
      workflowId = event.workflowId
      return
    case "dependency.added":
      return
    case "step.status":
      await publishStep(event.stepId, event.status)
      return
    case "workflow.completed":
      completed = true
      return
  }
}

const child = spawn(process.execPath, ["--import", "tsx", workflow], {
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
  if (checks.size === 0) {
    await publishStep("startup", "failed")
  } else {
    for (const [stepId, check] of checks) {
      if (check.status === "queued" || check.status === "running") {
        await publishStep(stepId, check.status === "running" ? "failed" : "skipped")
      }
    }
  }
}

if (reportingError) throw reportingError
if (exitCode !== 0) throw new Error(`Effect CI exited with code ${exitCode}`)

console.log(`Effect CI completed with ${checks.size} checks`)
