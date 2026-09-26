import {
  createCheck,
  type CheckConclusion,
} from "@effect-ci-testbed/github"

const required = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

type JobResult = "success" | "failure" | "cancelled" | "skipped"

const results = JSON.parse(required("EFFECT_CI_RESULTS")) as Record<string, JobResult>
const statuses = Object.values(results)

const conclusion: CheckConclusion = statuses.includes("failure")
  ? "failure"
  : statuses.includes("cancelled")
    ? "cancelled"
    : statuses.every((status) => status === "skipped")
      ? "skipped"
      : statuses.every((status) => status === "success")
        ? "success"
        : "neutral"

const icon = (result: JobResult): string => {
  switch (result) {
    case "success": return "✅"
    case "failure": return "❌"
    case "cancelled": return "⏹️"
    case "skipped": return "⏭️"
  }
}

const rows = Object.entries(results)
  .map(([name, result]) => `| ${name} | ${icon(result)} ${result} |`)
  .join("\n")

const check = await createCheck({
  token: required("GITHUB_TOKEN"),
  repository: required("GITHUB_REPOSITORY"),
  sha: required("EFFECT_CI_SHA"),
  name: "Effect CI",
  title: conclusion === "success" ? "All workflows passed" : "Workflow run completed",
  summary: `| Workflow | Result |\n| --- | --- |\n${rows}`,
  conclusion,
  ...(process.env.EFFECT_CI_DETAILS_URL
    ? { detailsUrl: process.env.EFFECT_CI_DETAILS_URL }
    : {}),
  ...(process.env.EFFECT_CI_EXTERNAL_ID
    ? { externalId: process.env.EFFECT_CI_EXTERNAL_ID }
    : {}),
})

console.log(`Effect CI check: ${check.htmlUrl}`)
