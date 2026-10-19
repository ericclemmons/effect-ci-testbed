// LOCAL operator integration. Never imported by the deployed AI broker.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createCheck, updateCheck } from "../../../../packages/github/src/index.ts"
import { BROKEN_SOURCE, FIXED_SOURCE, REPAIR_BASE, REPAIR_COMMAND, REPAIR_REPOSITORY,
  proposeRepair, repairBlobHash, withRepairCheckToken, withRepairInstallationToken } from "../../../../packages/github/src/repair.ts"
import { BUDGET_NAME } from "../src/budget.ts"
import { PACKAGE_SOURCE, TEST_SOURCE, verifyLocal } from "./local-verifier.ts"

const initialMain = "ecf13c17597b2718e44509e8850eba1b0b15866d"
const runId = "friday-repair-20261013-1"
const nativeInstance = "coverage-repair-budget-proposal-20261013-1"
const directory = fileURLToPath(new URL("../.verification", import.meta.url))
const seedReceipt = directory + "github-seed-prepared.json"
const confirmedReceipt = directory + "github-seed-confirmed.json"
const proposalReceipt = directory + `github-proposal-${runId}.json`
const apiRoot = `https://api.github.com/repos/${REPAIR_REPOSITORY}`
const credentials = { appId: process.env.GITHUB_APP_ID ?? "", privateKey: process.env.GITHUB_PRIVATE_KEY ?? "" }
const sha = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{40}$/.test(value)

async function api(token: string, path: string, method = "GET", body?: unknown, missing = false): Promise<any> {
  const response = await fetch(apiRoot + path, { method, redirect: "manual", signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "effect-ci-proof",
      "content-type": "application/json", "x-github-api-version": "2026-03-10" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (missing && response.status === 404) { await response.body?.cancel().catch(() => undefined); return undefined }
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error(`Owned fixture API failed (${response.status})`) }
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Owned fixture API response unavailable")
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.length
      if (length > 64 * 1024) throw new Error("Owned fixture API response exceeds bound")
      chunks.push(next.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
function save(path: string, value: unknown) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 })
}

async function seed() {
  if (existsSync(seedReceipt) || existsSync(confirmedReceipt)) throw new Error("Seed receipt exists; reconcile instead of repeating writes")
  const broken = verifyLocal(BROKEN_SOURCE, TEST_SOURCE, PACKAGE_SOURCE)
  if (broken.exitCode !== 1) throw new Error("Owned baseline must actually fail")
  await withRepairInstallationToken(credentials, async token => {
    if (await api(token, `/git/ref/heads/${REPAIR_BASE}`, "GET", undefined, true)) throw new Error("Existing base branch must be preserved")
    const main = await api(token, "/git/ref/heads/main")
    if (main.object?.sha !== initialMain) throw new Error("Private fixture main changed; no writes")
    const original = await api(token, `/git/commits/${initialMain}`)
    if (!sha(original.tree?.sha)) throw new Error("Invalid main tree")
    const root = await api(token, `/git/trees/${original.tree.sha}`)
    if (root.truncated || !Array.isArray(root.tree) || root.tree.some((entry: any) => entry.path === "repair-demo")) throw new Error("Fixture directory exists or tree unavailable")
    const files = { "repair-demo/health.js": BROKEN_SOURCE, "repair-demo/health.test.mjs": TEST_SOURCE,
      "repair-demo/package.json": PACKAGE_SOURCE }
    const tree = []
    for (const [path, content] of Object.entries(files)) {
      const blob = await api(token, "/git/blobs", "POST", { content, encoding: "utf-8" })
      if (blob.sha !== await repairBlobHash(content)) throw new Error("Seed blob identity mismatch")
      tree.push({ path, mode: "100644", type: "blob", sha: blob.sha })
    }
    const nextTree = await api(token, "/git/trees", "POST", { base_tree: original.tree.sha, tree })
    if (!sha(nextTree.sha)) throw new Error("Invalid seed tree")
    const commit = await api(token, "/git/commits", "POST", { message: "Seed owned Friday repair fixture\n\nEffect-CI-Fixture: friday-repair-v1", tree: nextTree.sha, parents: [initialMain] })
    if (!sha(commit.sha)) throw new Error("Invalid seed commit")
    save(seedReceipt, { state: "prepared", repository: REPAIR_REPOSITORY, branch: REPAIR_BASE, commit: commit.sha,
      parent: initialMain, failingCheck: { exitCode: broken.exitCode, sourceDigest: broken.sourceDigest, elapsedMs: broken.elapsedMs } })
    await api(token, "/git/refs", "POST", { ref: `refs/heads/${REPAIR_BASE}`, sha: commit.sha })
    const observed = await api(token, `/git/ref/heads/${REPAIR_BASE}`)
    const afterMain = await api(token, "/git/ref/heads/main")
    if (observed.object?.sha !== commit.sha || afterMain.object?.sha !== initialMain) throw new Error("Seed refs need reconciliation")
    save(confirmedReceipt, { repository: REPAIR_REPOSITORY, branch: REPAIR_BASE, commit: commit.sha, mainPreserved: initialMain })
    console.log(JSON.stringify({ stage: "seed-confirmed", commit: commit.sha, baselineExitCode: 1, mainUnchanged: true }))
  })
}

async function propose() {
  if (existsSync(proposalReceipt)) throw new Error("Proposal receipt exists; inspect the PR rather than repeating the run")
  const seed = JSON.parse(readFileSync(confirmedReceipt, "utf8"))
  if (seed.repository !== REPAIR_REPOSITORY || seed.branch !== REPAIR_BASE || !sha(seed.commit)) throw new Error("Confirmed owned seed required")
  const native = JSON.parse(execFileSync(process.env.CF_BIN ?? "/Users/eric/Library/pnpm/bin/cf", ["workflows", "instances", "get", nativeInstance,
    "--workflow-name", "effect-ci-repair-budget-probe"], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 }))
  if (native.status !== "complete" || native.params.mode !== "proposal" || native.output.before.budget !== BUDGET_NAME ||
      native.output.inferenceCalled !== true || native.output.patchApplied !== false) throw new Error("Recorded native proposal is not valid evidence")
  let verification: unknown
  const result = await proposeRepair(credentials, { runId, baseCommit: seed.commit, proposedText: native.output.proposedText }, async input =>
    withRepairCheckToken(credentials, async token => {
      const file = async (path: string, expected: string) => {
        const entry = await api(token, `/contents/repair-demo/${path}?ref=${input.commit}`)
        if (entry.type !== "file" || entry.encoding !== "base64" || typeof entry.content !== "string" ||
            entry.sha !== await repairBlobHash(expected) || entry.content.replace(/\s/g, "") !== btoa(expected)) throw new Error("Exact commit file identity mismatch")
        return expected
      }
      const source = await file("health.js", FIXED_SOURCE)
      const tests = await file("health.test.mjs", TEST_SOURCE)
      const packageJson = await file("package.json", PACKAGE_SOURCE)
      const checked = verifyLocal(source, tests, packageJson)
      if (!checked.passed || checked.sourceDigest !== input.sourceDigest || input.command !== REPAIR_COMMAND) throw new Error("Exact commit check failed")
      const name = "Effect CI repair / owned health check (local)"
      const externalId = `owned-repair:${runId}:${input.commit}:${input.sourceDigest}`
      const listed = await api(token, `/commits/${input.commit}/check-runs?check_name=${encodeURIComponent(name)}&filter=all&per_page=100`)
      if (!Array.isArray(listed.check_runs) || listed.total_count > 100) throw new Error("Check inventory incomplete")
      const owned = listed.check_runs.filter((check: any) => check.external_id === externalId && check.app?.id === 5089816 && check.head_sha === input.commit)
      if (owned.length > 1) throw new Error("Ambiguous check identity")
      const output = { title: "Owned health check passed locally", summary: `Exact commit ${input.commit}.\n${REPAIR_COMMAND}\nSource SHA-256: ${input.sourceDigest}\nNative model proposal: ${nativeInstance}.\nLocal Node execution; not a hosted Flue repair.`,
        text: checked.output, conclusion: "success" as const }
      const check = owned.length ? await updateCheck({ token, repository: REPAIR_REPOSITORY, checkId: owned[0].id, ...output }) :
        await createCheck({ token, repository: REPAIR_REPOSITORY, sha: input.commit, name, externalId, ...output })
      verification = { commit: input.commit, sourceDigest: input.sourceDigest, environment: "local-node", command: REPAIR_COMMAND,
        elapsedMs: checked.elapsedMs, exitCode: checked.exitCode, checkId: check.id, directory: checked.directory }
      return { commit: input.commit, sourceDigest: input.sourceDigest, passed: true as const, evidenceId: `github_check_${check.id}` }
    }))
  save(proposalReceipt, { ...result, nativeInstance, verification, flueVerified: false, hostedWriterVerified: false, workersIssuesVerified: false })
  console.log(JSON.stringify({ stage: "proposal-confirmed", ...result, flueVerified: false, hostedWriterVerified: false }))
}

if (import.meta.main) {
  try {
    if (process.argv[2] === "seed") await seed()
    else if (process.argv[2] === "propose") await propose()
    else throw new Error("Explicit seed or propose mode required")
  } catch (error) {
    const message = error instanceof Error && /^(Owned |Seed |Existing base branch|Private fixture main changed|Fixture directory exists|Invalid (main|seed)|Repair (policy|token|API|base|fixture|branch|exact-commit|refs|PR)|Confirmed owned seed|Recorded native proposal|Exact commit (file identity mismatch|check failed)|Check inventory incomplete|Ambiguous check identity|Proposal receipt exists|Explicit seed or propose)/.test(error.message)
      ? error.message : "Operation failed; upstream bodies omitted"
    console.error(`${message}. Inspect stage receipts before retrying.`)
    process.exitCode = 1
  }
}
