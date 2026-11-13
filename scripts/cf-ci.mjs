// Runs one recipe's cf ci pipeline against this GitHub repository through the `scm` binding:
// deploy .cloudflare/cf-ci with Wrangler, start a run on a pushed commit, and wait for it.
// The pipeline writes its own `<recipe> / cf-ci` GitHub check and, with --mr, comments on the pull request.
// Usage: node scripts/cf-ci.mjs <recipe> [--sha <sha>] [--ref <ref>] [--mr <number>]
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, the Cloudflare GitHub app on the repository,
// and `npm ci` in the recipe's .cloudflare/cf-ci.
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"

const { positionals: [recipe], values } = parseArgs({ allowPositionals: true, options: { sha: { type: "string" }, ref: { type: "string" }, mr: { type: "string" } } })
if (!recipe) throw new Error("Usage: node scripts/cf-ci.mjs <recipe> [--sha <sha>] [--ref <ref>] [--mr <number>]")
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = process.env.CLOUDFLARE_API_TOKEN
if (!accountId || !apiToken) throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN")

const root = resolve(import.meta.dirname, "..")
const pipelineDir = join(root, "examples", recipe, ".cloudflare", "cf-ci")
const workflow = `cf-ci-${recipe}`
// GitHub serves the tarball, so the commit must already be pushed. The pipeline always comes from this checkout.
const sha = values.sha ?? process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
const ref = values.ref ?? process.env.GITHUB_REF
const mr = values.mr ? Number(values.mr) : undefined
const pipelineSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const log = (message) => console.log(`[cf-ci ${recipe}] ${message}`)

async function api(method, path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    method, headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body),
  })
  const json = await response.json()
  if (!json.success) throw new Error(`${method} ${path} failed: ${JSON.stringify(json.errors)}`)
  return json.result
}

async function latestVersion() {
  try {
    const [latest] = await api("GET", `/workflows/${workflow}/versions?per_page=1`)
    return latest?.id
  } catch (error) {
    // The first deploy of a recipe creates its Workflow.
    if (String(error.message).includes("not_found")) return undefined
    throw error
  }
}

async function deploy() {
  const before = await latestVersion()
  log(`deploying pipeline ${pipelineSha}`)
  // A secret rather than --var, so the value stays out of wrangler.jsonc and the deploy log.
  const dir = mkdtempSync(join(tmpdir(), `${workflow}-`))
  const secrets = join(dir, "secrets.json")
  writeFileSync(secrets, JSON.stringify({ PIPELINE_SHA: pipelineSha }))
  try {
    execFileSync(join(pipelineDir, "node_modules", ".bin", "wrangler"), ["deploy", "--secrets-file", secrets, "--tag", pipelineSha.slice(0, 25)], {
      cwd: pipelineDir, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId },
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    const after = await latestVersion()
    if (after && after !== before) return after
    await sleep(2000)
  }
  throw new Error("wrangler deploy finished but no new Workflow version appeared")
}

// The first step reports the PIPELINE_SHA the run executes. Other steps first means older code.
async function pipelineOf(id) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const details = await api("GET", `/workflows/${workflow}/instances/${id}`)
    const steps = details.steps ?? []
    // The API suffixes step names with their call count, such as "pipeline version-1".
    const step = steps.find((candidate) => /^pipeline version(-\d+)?$/.test(candidate.name ?? ""))
    if (step && step.output !== undefined && step.output !== null) return typeof step.output === "string" ? step.output : JSON.stringify(step.output)
    if (!step && steps.some((candidate) => candidate.type === "step" || candidate.name)) return `older code (first step ${steps[0]?.name})`
    if (["complete", "errored", "terminated"].includes(details.status)) return `ended as ${details.status}`
    await sleep(2000)
  }
  return "unknown"
}

async function terminate(id) {
  try {
    await api("PATCH", `/workflows/${workflow}/instances/${id}/status`, { status: "terminate" })
  } catch (error) {
    log(`could not terminate ${id}: ${error.message}`)
  }
}

async function waitForResult(id) {
  const deadline = Date.now() + 15 * 60_000
  while (Date.now() < deadline) {
    const details = await api("GET", `/workflows/${workflow}/instances/${id}`)
    if (["complete", "errored", "terminated"].includes(details.status)) return details
    await sleep(5000)
  }
  await terminate(id)
  throw new Error(`instance ${id} did not finish within 15 minutes; terminated it`)
}

const expectedVersion = await deploy()
const params = { sha, ...(ref && { ref }), ...(mr && { mr }) }

let instance
for (let attempt = 1; attempt <= 10 && !instance; attempt++) {
  const { id } = await api("POST", `/workflows/${workflow}/instances`, { params })
  const ran = await pipelineOf(id)
  if (ran === pipelineSha) {
    instance = id
    break
  }
  // Runs started in the first minutes after a deploy can execute the previous pipeline.
  log(`instance ${id} ran pipeline ${ran}; expected ${pipelineSha} (version ${expectedVersion}). Retrying.`)
  await terminate(id)
  await sleep(30_000)
}
if (!instance) throw new Error(`no run executed pipeline ${pipelineSha}`)

log(`started instance ${instance} on ${sha}${mr ? ` (pull request #${mr})` : ""}`)
const result = await waitForResult(instance)
const output = result.output ?? {}
const label = (name, check) => `${name}${check.optional ? " (optional)" : ""}`
const status = (check) => check.skipped ? "⏭️ skipped" : `${check.exitCode === 0 ? "✅" : "❌"} ${check.exitCode}`
for (const [name, check] of Object.entries(output.checks ?? {})) {
  console.log(`\n=== ${label(name, check)}: ${status(check)} ===\n${check.log}`)
}
if (output.checkUrl) log(`GitHub check: ${output.checkUrl}`)
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = Object.entries(output.checks ?? {}).map(([name, check]) => `| ${label(name, check)} | ${status(check)} |`)
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### cf ci: ${recipe}`,
    `Instance \`${instance}\`, status \`${result.status}\`${output.checkUrl ? `, [check](${output.checkUrl})` : ""}`,
    "", "| Check | Exit |", "| --- | --- |", ...rows, "",
  ].join("\n"), { flag: "a" })
}
if (result.status !== "complete") throw new Error(`instance ${instance} ended as ${result.status}: ${JSON.stringify(result.error ?? result.steps?.at(-1))}`)
if (output.pipelineSha !== pipelineSha) throw new Error(`instance ran pipeline ${output.pipelineSha}, expected ${pipelineSha}`)
if (!output.passed) throw new Error("one or more checks failed")
log(`passed (instance ${instance})`)
