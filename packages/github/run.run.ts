import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { Readable } from "node:stream"
import { fileURLToPath } from "node:url"
import type { RuntimeEvent } from "@effect-ci-testbed/ci"
import { Reporter } from "@effect-ci-testbed/github"

const required = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)

  return value
}

const reporter = new Reporter({
  token: required("GITHUB_TOKEN"),
  repository: required("GITHUB_REPOSITORY"),
  sha: required("EFFECT_CI_SHA"),
  ...(process.env.EFFECT_CI_DETAILS_URL
    ? { detailsUrl: process.env.EFFECT_CI_DETAILS_URL }
    : {}),
  ...(process.env.EFFECT_CI_EXTERNAL_ID
    ? { externalId: process.env.EFFECT_CI_EXTERNAL_ID }
    : {}),
})
const runtime = fileURLToPath(new URL("../cli/src/bin.ts", import.meta.url))
const child = spawn(process.execPath, [
  runtime,
  "--workflow",
  required("EFFECT_CI_WORKFLOW"),
  process.env.DRY_RUN ? "plan" : "run",
], {
  env: { ...process.env, EFFECT_CI_EVENT_FD: "3" },
  stdio: ["inherit", "inherit", "inherit", "pipe"],
})
const eventStream = child.stdio[3] as Readable | null

if (!eventStream) throw new Error("Effect CI event stream is unavailable")

let reportingError: unknown
const reporting = (async () => {
  const lines = createInterface({ input: eventStream })

  for await (const line of lines) {
    await reporter.report(JSON.parse(line) as RuntimeEvent)
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

if (!reporter.isComplete) await reporter.abort()
if (reportingError) throw reportingError
if (exitCode !== 0) throw new Error(`Effect CI exited with code ${exitCode}`)

console.log(`Effect CI completed with ${reporter.size} checks`)
