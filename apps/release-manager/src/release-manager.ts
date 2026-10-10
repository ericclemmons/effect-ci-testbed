import { beginRelease, releaseAllocation, type VersionAllocation } from "../../../packages/cloudflare/src/release-policy.ts"

export const RELEASE_ACCOUNT = "0db135ec469e2f216fcea26426f29755"
export const RELEASE_SCRIPT = "effect-ci-hmd-demo"
export interface Deployment { readonly id: string; readonly versions: ReadonlyArray<VersionAllocation>; readonly message?: string }
interface Intent { readonly sequence: number; readonly expected: string; readonly versions: ReadonlyArray<VersionAllocation>; readonly message: string; readonly phase: number; readonly rollback: boolean }
export interface ReleaseJournal {
  readonly owner: string
  readonly candidate: string
  readonly previous: ReadonlyArray<VersionAllocation>
  readonly deployment: Deployment
  readonly phase: number
  readonly sequence: number
  readonly status: "active" | "complete" | "rolled-back"
  readonly pending?: Intent
}
export interface ReleaseStore { read(): Promise<ReleaseJournal | undefined>; write(value: ReleaseJournal): Promise<void> }
export interface DeploymentAPI { latest(): Promise<Deployment>; create(versions: ReadonlyArray<VersionAllocation>, message: string): Promise<Deployment> }
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
const sameAllocation = (left: ReadonlyArray<VersionAllocation>, right: ReadonlyArray<VersionAllocation>) =>
  left.length === right.length && left.every((entry) => right.some((other) => entry.version === other.version && Math.abs(entry.percentage - other.percentage) < 1e-8))
const validDeployment = (value: Deployment) => uuid(value.id) && value.versions.length > 0 &&
  value.versions.every((entry) => uuid(entry.version) && Number.isFinite(entry.percentage) && entry.percentage >= 0.01 && entry.percentage <= 100) &&
  new Set(value.versions.map((entry) => entry.version)).size === value.versions.length &&
  Math.abs(value.versions.reduce((sum, entry) => sum + entry.percentage, 0) - 100) < 1e-8

/** Trusted RPC caller owns health decisions. This capability cannot choose another script/account.
 * Store an intent BEFORE every write; ambiguous writes require reconciliation, never blind retries.
 * A singleton DO serializes callers. External dashboard writes are detected, not atomically fenced.
 */
export class ReleaseManager {
  private readonly store: ReleaseStore
  private readonly api: DeploymentAPI
  constructor(store: ReleaseStore, api: DeploymentAPI) { this.store = store; this.api = api }
  async begin(owner: string, candidate: string): Promise<ReleaseJournal> {
    if (typeof owner !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(owner) || !uuid(candidate)) throw new Error("Invalid release identity")
    const existing = await this.store.read()
    if (existing?.owner === owner) {
      if (existing.candidate !== candidate) throw new Error("Release identity changed")
      return existing
    }
    if (existing?.status === "active" || existing?.pending) throw new Error("Another release owns the target")
    const deployment = await this.api.latest()
    if (!validDeployment(deployment)) throw new Error("Invalid current deployment")
    const state = beginRelease(candidate, deployment.versions)
    const journal: ReleaseJournal = { owner, candidate, previous: state.previous, deployment, phase: -1, sequence: 0, status: "active" }
    await this.store.write(journal)
    return journal
  }
  private async owned(owner: string): Promise<ReleaseJournal> {
    const journal = await this.store.read()
    if (!journal || journal.owner !== owner) throw new Error("Release ownership mismatch")
    return journal
  }
  async reconcile(owner: string): Promise<ReleaseJournal> {
    const journal = await this.owned(owner)
    if (!journal.pending) return journal
    const latest = await this.api.latest()
    const intent = journal.pending
    if (!validDeployment(latest) || latest.id === intent.expected || latest.message !== intent.message || !sameAllocation(latest.versions, intent.versions)) {
      throw new Error("Unresolved deployment intent; operator review required")
    }
    return this.accept(journal, latest)
  }
  private async accept(journal: ReleaseJournal, deployment: Deployment): Promise<ReleaseJournal> {
    const intent = journal.pending!
    const { pending: _pending, ...rest } = journal
    const resolved: ReleaseJournal = { ...rest, deployment, phase: intent.phase, sequence: intent.sequence,
      status: intent.rollback ? "rolled-back" : "active" }
    await this.store.write(resolved)
    return resolved
  }
  private async mutate(journal: ReleaseJournal, versions: ReadonlyArray<VersionAllocation>, phase: number, rollback: boolean): Promise<ReleaseJournal> {
    if (!validDeployment({ id: journal.deployment.id, versions })) throw new Error("Allocation cannot be represented by deployment API")
    const latest = await this.api.latest()
    if (!validDeployment(latest) || latest.id !== journal.deployment.id || !sameAllocation(latest.versions, journal.deployment.versions)) throw new Error("Deployment ownership drift; refusing overwrite")
    const sequence = journal.sequence + 1
    const intent: Intent = { sequence, expected: latest.id, versions, phase, rollback, message: `effect-ci-release:${journal.owner}:${sequence}` }
    const pending = { ...journal, pending: intent }
    await this.store.write(pending)
    const deployed = await this.api.create(versions, intent.message)
    if (!validDeployment(deployed) || deployed.id === latest.id || deployed.message !== intent.message || !sameAllocation(deployed.versions, versions)) throw new Error("Ambiguous deployment acknowledgement; reconcile required")
    return this.accept(pending, deployed)
  }
  async promote(owner: string, percentage: number): Promise<ReleaseJournal> {
    if (![10, 25, 75, 100].includes(percentage)) throw new Error("Invalid release percentage")
    let journal = await this.owned(owner)
    if (journal.pending) journal = await this.reconcile(owner)
    const phases = [10, 25, 75, 100]
    if (journal.status !== "active") throw new Error("Release is terminal")
    if (percentage === phases[journal.phase]) {
      const latest = await this.api.latest()
      if (!validDeployment(latest) || latest.id !== journal.deployment.id || !sameAllocation(latest.versions, journal.deployment.versions)) throw new Error("Deployment ownership drift")
      return journal // Durable successful replay, no write.
    }
    if (percentage !== phases[journal.phase + 1]) throw new Error("Release phase must advance in order")
    const state = { ...beginRelease(journal.candidate, journal.previous), phase: journal.phase + 1 }
    return this.mutate(journal, releaseAllocation(state), state.phase, false)
  }
  async rollback(owner: string): Promise<ReleaseJournal> {
    let journal = await this.owned(owner)
    if (journal.pending) journal = await this.reconcile(owner)
    if (journal.status === "rolled-back") return journal
    if (journal.status !== "active") throw new Error("Release is terminal")
    return this.mutate(journal, journal.previous, journal.phase, true)
  }
  async complete(owner: string): Promise<ReleaseJournal> {
    const journal = await this.owned(owner)
    if (journal.pending || journal.phase !== 3 || journal.status === "rolled-back") throw new Error("Release is not ready to complete")
    const latest = await this.api.latest()
    if (!validDeployment(latest) || latest.id !== journal.deployment.id || !sameAllocation(latest.versions, journal.deployment.versions)) throw new Error("Deployment ownership drift")
    const completed = { ...journal, status: "complete" as const }
    await this.store.write(completed)
    return completed
  }
}

/** No caller-supplied URLs, credentials, force flag or automatic deployment-write retry. */
export function deploymentAPI(token: () => string, transport: typeof fetch = fetch): DeploymentAPI {
  const base = `https://api.cloudflare.com/client/v4/accounts/${RELEASE_ACCOUNT}/workers/scripts/${RELEASE_SCRIPT}/deployments`
  const request = async (method: string, body?: unknown) => {
    let status: number | undefined
    let stage = "credential"
    try {
    const credential = token()
    if (typeof credential !== "string" || !/^[A-Za-z0-9_-]+$/.test(credential)) throw new Error("Invalid credential format")
    stage = "timeout"
    const signal = AbortSignal.timeout(15_000)
    stage = "transport"
    const response = await transport(method === "GET" ? `${base}?per_page=1` : base, { method, redirect: "manual", signal,
      headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}) })
    status = response.status
    stage = "response"
    if (!response.ok) { await response.body?.cancel(); throw new Error("Release API request failed") }
    const reader = response.body?.getReader()
    if (!reader) throw new Error("Missing release response")
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.length
        if (size > 128 * 1024) throw new Error("Oversized release response")
        chunks.push(chunk.value)
      }
    } finally { await reader.cancel() }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { success?: boolean; result?: unknown }
    if (payload.success !== true) throw new Error("Release API request failed")
    return payload.result
    } catch { throw new Error(`Release API request failed (${stage}${status === undefined ? "" : `, HTTP ${status}`})`) }
  }
  const decode = (value: any): Deployment => {
    const deployment: Deployment = { id: value?.id, versions: Array.isArray(value?.versions) ? value.versions.map((entry: any) => ({ version: entry.version_id, percentage: entry.percentage })) : [],
      ...(typeof value?.annotations?.["workers/message"] === "string" ? { message: value.annotations["workers/message"] } : {}) }
    if (!validDeployment(deployment)) throw new Error("Invalid release API response")
    return deployment
  }
  const latest = async () => {
      const result = await request("GET") as { deployments?: unknown[] }
      if (!Array.isArray(result?.deployments) || !result.deployments.length) throw new Error("Missing current deployment")
      return decode(result.deployments[0])
    }
  return {
    latest,
    create: async (versions, message) => {
      await request("POST", { strategy: "percentage", versions: versions.map((entry) => ({ version_id: entry.version, percentage: entry.percentage })), annotations: { "workers/message": message } })
      // Read back the active allocation. Write acknowledgements alone are not proof
      // of ownership or allocation; the journal validates this read's annotation.
      return latest()
    },
  }
}
