import { createAppJwt, type GitHubAppCredentials } from "./app.ts"

// Host policy, not a project/model-selected destination. No main writes or deploy API.
export const REPAIR_REPOSITORY = "ericclemmons/effect-ci-private-github-fixture"
export const REPAIR_BASE = "demo/friday-repair"
export const REPAIR_PATH = "repair-demo/health.js"
export const REPAIR_COMMAND = "node --test repair-demo/health.test.mjs"
export const BROKEN_SOURCE = "export function healthStatus() { return 500; }\n"
export const FIXED_SOURCE = "export function healthStatus() { return 200; }\n"
const APP_ID = "5089816"
// Stable bot ID corroborated against the owned App's existing and current PRs.
// GitHub App renames change the login, not this identity or installation scope.
const REPAIR_BOT_ID = 334321206
const INSTALLATION = 165265172
const root = `https://api.github.com/repos/${REPAIR_REPOSITORY}`
const encoder = new TextEncoder()
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value)
const record = (value: unknown): value is Record<string, any> => typeof value === "object" && value !== null && !Array.isArray(value)
const reject = () => new Error("Repair policy rejected the request")
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("")
const digest = async (algorithm: string, bytes: Uint8Array) => hex(await crypto.subtle.digest(algorithm, bytes.buffer as ArrayBuffer))

export function repairSource(proposal: unknown): string {
  if (typeof proposal !== "string" || encoder.encode(proposal).length > 1024) throw reject()
  let text = proposal.trim()
  if (text.startsWith("```")) {
    const fenced = /^```(?:javascript|js)?\n([\s\S]*)\n```$/.exec(text)
    if (!fenced) throw reject()
    text = fenced[1]!.trim()
  }
  if (!/^export\s+function\s+healthStatus\s*\(\s*\)\s*\{\s*return\s+200\s*;\s*\}$/.test(text)) throw reject()
  return FIXED_SOURCE
}

export interface GitTreeEntry { path: string; mode: "040000" | "100644" | "100755"; type: "tree" | "blob"; sha: string }
/** Hash actual Git tree bytes, not an actor-supplied prepared-source fingerprint. */
export async function repairTreeHash(entries: readonly GitTreeEntry[]) {
  const ordered = [...entries].sort((a, b) => {
    const left = encoder.encode(a.path + (a.type === "tree" ? "/" : ""))
    const right = encoder.encode(b.path + (b.type === "tree" ? "/" : ""))
    for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i]! - right[i]!
    return left.length - right.length
  })
  const chunks = ordered.map(entry => {
    const name = encoder.encode(`${entry.mode === "040000" ? "40000" : entry.mode} ${entry.path}\0`)
    const bytes = Uint8Array.from(entry.sha.match(/../g)!, value => parseInt(value, 16))
    return Uint8Array.from([...name, ...bytes])
  })
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  return digest("SHA-1", Uint8Array.from([...encoder.encode(`tree ${length}\0`), ...chunks.flatMap(chunk => [...chunk])]))
}
export async function repairBlobHash(text: string) {
  const bytes = encoder.encode(text)
  return digest("SHA-1", Uint8Array.from([...encoder.encode(`blob ${bytes.length}\0`), ...bytes]))
}

async function json(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Repair API returned invalid data")
  let size = 0
  const parts: Uint8Array[] = []
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.length
      if (size > 64 * 1024) throw new Error("Repair API returned invalid data")
      parts.push(next.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const part of parts) { bytes.set(part, offset); offset += part.length }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) }
    catch { throw new Error("Repair API returned invalid data") }
  } catch { throw new Error("Repair API returned invalid data") }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}

async function request(fetcher: typeof fetch, url: string, token: string, method = "GET", body?: unknown, missing = false) {
  let response: Response
  try { response = await fetcher(url, { method, redirect: "manual", signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`,
      "user-agent": "effect-ci-testbed", "x-github-api-version": "2026-03-10", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) } catch { throw new Error("Repair API transport failed; reconcile before retrying") }
  if (response.status === 404 && missing) { await response.body?.cancel().catch(() => undefined); return undefined }
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error(`Repair API request failed (${response.status})`) }
  if (method === "DELETE") { await response.body?.cancel().catch(() => undefined); return undefined }
  return json(response)
}

/** Only the host calls this. Neither arbitrary installations nor repositories are parameters. */
async function withToken<T>(credentials: GitHubAppCredentials, permissions: Record<string, string>,
  operation: (token: string) => Promise<T>, fetcher: typeof fetch): Promise<T> {
  if (credentials.appId !== APP_ID) throw reject()
  const jwt = await createAppJwt(credentials)
  const result = await request(fetcher, `https://api.github.com/app/installations/${INSTALLATION}/access_tokens`, jwt, "POST", {
    repositories: [REPAIR_REPOSITORY.split("/")[1]], permissions,
  })
  if (!record(result) || typeof result.token !== "string" || !result.token || result.token.length > 1024) throw new Error("Repair token unavailable")
  const token = result.token
  try {
    if (!record(result.permissions) || Object.entries(permissions).some(([key, value]) => result.permissions[key] !== value) ||
        Object.keys(result.permissions).some(key => ![...Object.keys(permissions), "metadata"].includes(key)) ||
        (result.permissions.metadata !== undefined && result.permissions.metadata !== "read")) throw new Error("Repair token permissions rejected")
    return await operation(token)
  } finally { await request(fetcher, "https://api.github.com/installation/token", token, "DELETE") }
}

export function withRepairInstallationToken<T>(credentials: GitHubAppCredentials,
  operation: (token: string) => Promise<T>, fetcher: typeof fetch = fetch) {
  return withToken(credentials, { contents: "write", pull_requests: "write" }, operation, fetcher)
}

/** Verification can read this repo and publish checks, but cannot write its code or PRs. */
export function withRepairCheckToken<T>(credentials: GitHubAppCredentials,
  operation: (token: string) => Promise<T>, fetcher: typeof fetch = fetch) {
  return withToken(credentials, { contents: "read", checks: "write" }, operation, fetcher)
}

/** Read-only reconciliation cannot mutate code, checks, or PRs. */
export function withRepairReadToken<T>(credentials: GitHubAppCredentials,
  operation: (token: string) => Promise<T>, fetcher: typeof fetch = fetch) {
  return withToken(credentials, { contents: "read", pull_requests: "read", checks: "read" }, operation, fetcher)
}

export interface RepairVerification {
  commit: string
  sourceDigest: string
  passed: true
  evidenceId: string
}
export interface RepairVerificationInput {
  repository: typeof REPAIR_REPOSITORY
  commit: string
  path: typeof REPAIR_PATH
  source: string
  sourceDigest: string
  command: typeof REPAIR_COMMAND
}
interface RepairOptions {
  runId: string
  baseCommit: string
  proposedText: unknown
}

/** Constructor callback is trusted host code, NEVER an RPC argument or model-provided proof. */
export async function proposeRepair(credentials: GitHubAppCredentials, options: RepairOptions,
  verify: (input: RepairVerificationInput) => Promise<RepairVerification>, fetcher: typeof fetch = fetch) {
  return repairAttempt(credentials, options, verify, fetcher, true)
}

/** Inspect the SAME existing candidate/PR. Missing artifacts never authorize creation.
 * The trusted callback must read retained native evidence, never execute a command.
 */
export async function reconcileRepair(credentials: GitHubAppCredentials, options: RepairOptions,
  readVerification: (input: RepairVerificationInput) => Promise<RepairVerification>, fetcher: typeof fetch = fetch) {
  return repairAttempt(credentials, options, readVerification, fetcher, false)
}

async function repairAttempt(credentials: GitHubAppCredentials, options: RepairOptions,
  verify: (input: RepairVerificationInput) => Promise<RepairVerification>, fetcher: typeof fetch,
  creationAllowed: boolean) {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(options.runId) || !sha(options.baseCommit)) throw reject()
  const source = repairSource(options.proposedText)
  const sourceDigest = await digest("SHA-256", encoder.encode(source))
  const branch = `codex/repair-${options.runId}`
  const message = `Repair owned demo health status\n\nEffect-CI-Repair: ${options.runId}\nEffect-CI-Base: ${options.baseCommit}\nEffect-CI-Patch-SHA256: ${sourceDigest}`
  const token = creationAllowed ? withRepairInstallationToken : withRepairReadToken
  return token(credentials, async token => {
    const api = (path: string, method?: string, body?: unknown, missing?: boolean) => {
      if (!creationAllowed && method !== undefined && method !== "GET") throw new Error("Read-only reconciliation cannot mutate repair artifacts")
      return request(fetcher, root + path, token, method, body, missing)
    }
    const ref = async (name: string, missing = false) => {
      const value = await api(`/git/ref/heads/${name}`, "GET", undefined, missing)
      if (value === undefined) return undefined
      if (!record(value) || value.ref !== `refs/heads/${name}` || value.object?.type !== "commit" || !sha(value.object.sha)) throw reject()
      return value.object.sha as string
    }
    const base = await ref(REPAIR_BASE)
    if (base !== options.baseCommit) throw new Error("Repair base changed; no writes permitted")
    const baseData = await api(`/git/commits/${base}`)
    if (!record(baseData) || baseData.sha !== base || !sha(baseData.tree?.sha)) throw reject()
    const tree = async (id: string): Promise<GitTreeEntry[]> => {
      const value = await api(`/git/trees/${id}`)
      if (!record(value) || value.sha !== id || value.truncated || !Array.isArray(value.tree) || value.tree.length > 128) throw reject()
      const names = new Set<string>()
      const entries: GitTreeEntry[] = value.tree.map((entry: unknown) => {
        if (!record(entry) || typeof entry.path !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(entry.path) || [".", ".."].includes(entry.path) || names.has(entry.path) ||
            !sha(entry.sha) || !(entry.type === "tree" && entry.mode === "040000" || entry.type === "blob" && ["100644", "100755"].includes(entry.mode))) throw reject()
        names.add(entry.path)
        return { path: entry.path, mode: entry.mode, type: entry.type, sha: entry.sha }
      })
      if (await repairTreeHash(entries) !== id) throw reject()
      return entries
    }
    const rootTree = await tree(baseData.tree.sha)
    const directory = rootTree.find(entry => entry.path === "repair-demo" && entry.type === "tree")
    if (!directory) throw reject()
    const directoryTree = await tree(directory.sha)
    const file = directoryTree.find(entry => entry.path === "health.js" && entry.type === "blob" && entry.mode === "100644")
    if (!file || file.sha !== await repairBlobHash(BROKEN_SOURCE)) throw new Error("Repair fixture is not the owned failing source")
    const blob = await api(`/git/blobs/${file.sha}`)
    if (!record(blob) || blob.sha !== file.sha || blob.encoding !== "base64" || typeof blob.content !== "string" ||
        blob.content.replace(/\s/g, "") !== btoa(BROKEN_SOURCE)) throw reject()
    const nextBlob = await repairBlobHash(source)
    const nextDirectory = await repairTreeHash(directoryTree.map(entry => entry.path === "health.js" ? { ...entry, sha: nextBlob } : entry))
    const nextRoot = await repairTreeHash(rootTree.map(entry => entry.path === "repair-demo" ? { ...entry, sha: nextDirectory } : entry))
    let commit = await ref(branch, true)
    if (commit === undefined) {
      if (!creationAllowed) throw new Error("Existing repair branch required; no writes permitted")
      const createdBlob = await api("/git/blobs", "POST", { content: source, encoding: "utf-8" })
      if (createdBlob?.sha !== nextBlob) throw reject()
      const createdTree = await api("/git/trees", "POST", { base_tree: baseData.tree.sha,
        tree: [{ path: REPAIR_PATH, mode: "100644", type: "blob", sha: nextBlob }] })
      if (createdTree?.sha !== nextRoot) throw reject()
      const createdCommit = await api("/git/commits", "POST", { message, tree: nextRoot, parents: [base] })
      if (!sha(createdCommit?.sha)) throw reject()
      commit = createdCommit.sha
      await api("/git/refs", "POST", { ref: `refs/heads/${branch}`, sha: commit })
    }
    const candidate = await api(`/git/commits/${commit}`)
    if (!record(candidate) || candidate.sha !== commit || candidate.tree?.sha !== nextRoot || candidate.message !== message ||
        !Array.isArray(candidate.parents) || candidate.parents.length !== 1 || candidate.parents[0]?.sha !== base) throw new Error("Repair branch is not the exact owned patch")
    let evidence: RepairVerification
    try { evidence = await verify({ repository: REPAIR_REPOSITORY, commit: commit!, path: REPAIR_PATH, source, sourceDigest, command: REPAIR_COMMAND }) }
    catch { throw new Error("Repair exact-commit verification failed; no PR created") }
    if (evidence?.passed !== true || evidence.commit !== commit || evidence.sourceDigest !== sourceDigest || typeof evidence.evidenceId !== "string" ||
        !/^[A-Za-z0-9_-]{1,96}$/.test(evidence.evidenceId)) throw new Error("Repair exact-commit verification failed; no PR created")
    if (await ref(REPAIR_BASE) !== base || await ref(branch) !== commit) throw new Error("Repair refs changed; no PR created")
    const marker = `<!-- effect-ci-repair:${options.runId} -->`
    const proof = `Verified commit: \`${commit}\`\nSource SHA-256: \`${sourceDigest}\`\nCheck: \`${REPAIR_COMMAND}\``
    const body = `${marker}\n\nOwned demo repair only; review before merging. No deployment.\n\n${proof}\nEvidence: \`${evidence.evidenceId}\``
    const title = "Repair owned demo health status"
    const existing = await api(`/pulls?head=ericclemmons:${branch}&base=${REPAIR_BASE}&state=all`)
    if (!Array.isArray(existing) || existing.length > 1) throw reject()
    const created = existing.length === 0
    if (created && !creationAllowed) throw new Error("Existing repair PR required; no writes permitted")
    const pr = created ? await api("/pulls", "POST", { title, body, head: branch, base: REPAIR_BASE }) : existing[0]
    if (!record(pr) || !Number.isSafeInteger(pr.number) || pr.number < 1 || pr.user?.id !== REPAIR_BOT_ID || pr.user?.type !== "Bot" ||
        pr.state !== "open" || pr.title !== title || pr.head?.ref !== branch || pr.head?.sha !== commit || pr.base?.ref !== REPAIR_BASE ||
        typeof pr.body !== "string" || !pr.body.includes(marker) || !pr.body.includes(proof)) throw new Error("Repair PR identity did not match; reconcile before retrying")
    return { repository: REPAIR_REPOSITORY, commit, sourceDigest, evidenceId: evidence.evidenceId,
      pullRequest: pr.number, url: `https://github.com/${REPAIR_REPOSITORY}/pull/${pr.number}`, created, deploymentPerformed: false }
  }, fetcher)
}
