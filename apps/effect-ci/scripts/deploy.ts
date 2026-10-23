import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { accessApplications } from "../access.config.ts"

const origin = process.env.EFFECT_CI_PUBLIC_URL
const reviewers = (process.env.EFFECT_CI_ACCESS_REVIEWERS ?? "")
  .split(",")
  .map((email) => email.trim())
  .filter(Boolean)

if (!origin || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  throw new Error("Set EFFECT_CI_PUBLIC_URL and CLOUDFLARE_ACCOUNT_ID before deployment")
}

const applications = accessApplications({
  hostname: new URL(origin).hostname,
  reviewers,
  slackCallbacks: process.env.EFFECT_CI_SLACK_CALLBACKS === "true",
  ...(process.env.EFFECT_CI_ACCESS_SERVICE_TOKEN_ID
    ? { serviceTokenId: process.env.EFFECT_CI_ACCESS_SERVICE_TOKEN_ID }
    : {}),
})
const cli = process.env.CF_BIN ?? "cf"

const accessCommand = (args: ReadonlyArray<string>): unknown => {
  const result = spawnSync(cli, ["zero-trust", "access", "applications", ...args], {
    encoding: "utf8",
    env: process.env,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Access provisioning failed: ${result.stderr || result.stdout}`)
  }

  return JSON.parse(result.stdout)
}

const dryRun = process.argv.includes("--dry-run")
const existing = dryRun ? [] : accessCommand(["list"])

if (!Array.isArray(existing)) {
  throw new Error("Expected an array from cf Access applications list")
}

// Install the narrow webhook exception before protecting the entire hostname.
for (const application of [applications.webhook, ...(applications.slack ? [applications.slack] : []), applications.service]) {
  const match = existing.find((entry) => entry.domain === application.domain)

  if (match && match.name !== application.name) {
    throw new Error(`An unmanaged Access application already covers ${application.domain}`)
  }

  if (dryRun) {
    console.log(`Access plan: ${JSON.stringify(application)}`)
  } else {
    accessCommand(match
      ? ["update", match.id, "--body", JSON.stringify(application)]
      : ["create", "--body", JSON.stringify(application)])
    console.log(`Access configured: ${application.name}`)
  }
}

if (!process.argv.includes("--access-only")) {
  const args = process.argv.slice(2).filter((argument) => argument !== "--")
  // Upload only documented Worker secrets, never operator Access/API credentials.
  const secretNames = [...readFileSync(new URL("../secrets.example.env", import.meta.url), "utf8")
    .matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]!)
  const secrets = Object.fromEntries(secretNames
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]))
  const temporary = mkdtempSync(join(tmpdir(), "effect-ci-secrets-"))
  try {
    if (!args.some((argument) => argument === "--secrets-file" || argument.startsWith("--secrets-file=")) && Object.keys(secrets).length > 0) {
      const path = join(temporary, "secrets.json")
      writeFileSync(path, JSON.stringify(secrets), { mode: 0o600 })
      args.push("--secrets-file", path)
    }
    const result = spawnSync(cli, ["deploy", ...args], {
      stdio: "inherit",
      env: process.env,
    })

    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
