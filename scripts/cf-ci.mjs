// Runs one recipe's cf ci comparison: deploy its pipeline with `cf`, push the recipe
// to its Artifacts repo, and wait for the run that push starts.
// Usage: node scripts/cf-ci.mjs <recipe>
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, and `npm ci` in the recipe's .cloudflare/cf-ci.
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const recipe = process.argv[2]
if (!recipe) throw new Error("Usage: node scripts/cf-ci.mjs <recipe>")
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = process.env.CLOUDFLARE_API_TOKEN
if (!accountId || !apiToken) throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN")

const root = resolve(import.meta.dirname, "..")
const recipeDir = join(root, "examples", recipe)
const pipelineDir = join(recipeDir, ".cloudflare", "cf-ci")
const namespace = "cf-ci"
const workflow = `cf-ci-${recipe}`
const sourceSha = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
const dirty = !process.env.GITHUB_SHA && execFileSync("git", ["status", "--porcelain", "--", `examples/${recipe}`], { cwd: root, encoding: "utf8" }).trim() !== ""
const pipelineSha = dirty ? `${sourceSha}-dirty` : sourceSha

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const log = (message) => console.log(`[cf-ci ${recipe}] ${message}`)
const cf = (args, options = {}) => execFileSync(join(pipelineDir, "node_modules", ".bin", "cf"), args, {
  cwd: pipelineDir, encoding: "utf8", stdio: ["ignore", "pipe", options.inherit ? "inherit" : "pipe"], env: { ...process.env, ...options.env },
})
const cfJson = (args) => JSON.parse(cf(args))
const git = (cwd, args, env = {}) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env } }).trim()

async function api(method, path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    method, headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body),
  })
  const json = await response.json()
  if (!json.success) throw new Error(`${method} ${path} failed: ${JSON.stringify(json.errors)}`)
  return json.result
}

const latestWorkflowVersion = () => cfJson(["workflows", "versions", "list", "--workflow-name", workflow])[0]?.id

async function deploy() {
  const before = latestWorkflowVersion()
  log(`deploying pipeline ${pipelineSha}`)
  cf(["deploy", "--tag", pipelineSha.slice(0, 25), "--message", `cf ci pipeline ${pipelineSha}`], {
    inherit: true, env: { CF_CI_PIPELINE_SHA: pipelineSha },
  })
  for (let attempt = 0; attempt < 30; attempt++) {
    const after = latestWorkflowVersion()
    if (after && after !== before) return after
    await sleep(2000)
  }
  throw new Error("cf deploy finished but no new Workflow version appeared")
}

// cf/config has no event triggers yet, so the trigger is applied with the same API Wrangler uses.
const applyTrigger = () => api("PUT", `/triggers/${workflow}`, [{
  type: "cf.artifacts.repo.pushed",
  filter: { namespace, repo_name: recipe },
  targets: [{ type: "workflow", script_name: workflow, workflow_name: workflow }],
}])

function ensureRepo() {
  try {
    return cfJson(["artifacts", "namespaces", "repos", "get", recipe, "--namespace", namespace]).remote
  } catch {
    log(`creating Artifacts repo ${namespace}/${recipe}`)
    return cfJson(["artifacts", "namespaces", "repos", "create", namespace, "--name", recipe]).remote
  }
}

function snapshot() {
  const dir = mkdtempSync(join(tmpdir(), `cf-ci-${recipe}-`))
  const files = git(root, ["ls-files", "-co", "--exclude-standard", "--", `examples/${recipe}`]).split("\n").filter(Boolean)
  for (const file of files) {
    const target = join(dir, file.slice(`examples/${recipe}/`.length))
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(root, file), target)
  }
  git(dir, ["init", "-q", "-b", "main"])
  git(dir, ["add", "-A"])
  return dir
}

function push(dir, remote, attempt) {
  const identity = { GIT_AUTHOR_NAME: "cf ci", GIT_AUTHOR_EMAIL: "cf-ci@localhost", GIT_COMMITTER_NAME: "cf ci", GIT_COMMITTER_EMAIL: "cf-ci@localhost" }
  git(dir, ["commit", "-q", "--allow-empty", "-m", `examples/${recipe} at ${pipelineSha} (attempt ${attempt})`], identity)
  const commit = git(dir, ["rev-parse", "HEAD"])
  const token = cfJson(["artifacts", "namespaces", "tokens", "create", namespace, "--repo", recipe, "--scope", "write", "--ttl", "600"]).plaintext
  git(dir, ["-c", `http.${remote}.extraHeader=Authorization: Bearer ${token}`, "push", "-q", "--force", remote, `HEAD:refs/heads/run/${commit}`])
  return commit
}

async function findInstance(commit, since) {
  for (let attempt = 0; attempt < 45; attempt++) {
    const instances = cfJson(["workflows", "instances", "list", "--workflow-name", workflow, "--per-page", "25"])
    for (const instance of instances.filter((candidate) => Date.parse(candidate.created_on) >= since - 5000)) {
      const details = cfJson(["workflows", "instances", "get", instance.id, "--workflow-name", workflow, "--simple", "true"])
      if (details.params?.payload?.after === commit) return instance
    }
    await sleep(2000)
  }
  throw new Error(`no Workflow instance started for pushed commit ${commit}`)
}

async function waitForResult(id) {
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    const details = cfJson(["workflows", "instances", "get", id, "--workflow-name", workflow])
    if (["complete", "errored", "terminated"].includes(details.status)) return details
    await sleep(5000)
  }
  cf(["workflows", "instances", "terminate", id, "--workflow-name", workflow, "--force"])
  throw new Error(`instance ${id} did not finish within 10 minutes; terminated it`)
}

const expectedVersion = await deploy()
await applyTrigger()
const remote = ensureRepo()
const dir = snapshot()

let instance
for (let attempt = 1; attempt <= 4 && !instance; attempt++) {
  const since = Date.now()
  const commit = push(dir, remote, attempt)
  log(`pushed ${commit}`)
  const found = await findInstance(commit, since)
  if (found.version_id === expectedVersion) {
    instance = found
    break
  }
  // A push shortly after a deploy can still start the previous Workflow version.
  log(`instance ${found.id} ran stale version ${found.version_id}; expected ${expectedVersion}. Retrying.`)
  cf(["workflows", "instances", "terminate", found.id, "--workflow-name", workflow, "--force"])
  await sleep(15_000)
}
if (!instance) throw new Error(`every push started a stale Workflow version instead of ${expectedVersion}`)

log(`waiting for instance ${instance.id}`)
const result = await waitForResult(instance.id)
const output = result.output ?? {}
for (const [name, check] of Object.entries(output.checks ?? {})) {
  console.log(`\n=== ${name} (exit ${check.exitCode}) ===\n${check.log}`)
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = Object.entries(output.checks ?? {}).map(([name, check]) => `| ${name} | ${check.exitCode === 0 ? "✅" : "❌"} ${check.exitCode} |`)
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, [`### cf ci: ${recipe}`, `Instance \`${instance.id}\`, status \`${result.status}\``, "", "| Check | Exit |", "| --- | --- |", ...rows, ""].join("\n"), { flag: "a" })
}
if (result.status !== "complete") throw new Error(`instance ${instance.id} ended as ${result.status}: ${JSON.stringify(result.error ?? result.steps?.at(-1))}`)
if (output.pipelineSha !== pipelineSha) throw new Error(`instance ran pipeline ${output.pipelineSha}, expected ${pipelineSha}`)
if (!output.passed) throw new Error("one or more checks failed")
log(`passed (instance ${instance.id})`)
