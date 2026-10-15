import { DurableObject } from "cloudflare:workers"
import type { ReleaseManager } from "../../release-manager/src/release-manager.ts"

export interface HmdCapability { readonly owner: string; readonly phase: number; readonly snapshot: string; readonly token: string }
interface ReviewRecord extends HmdCapability { readonly context: string; readonly expiresAt: number; readonly sample?: number; readonly state: "waiting" | "refreshing" | "sending" | "submitted" | "closed";
  readonly destination?: "demo";
  readonly decision?: "approved" | "rejected"; readonly reason?: string; readonly actor?: string; readonly acceptedAt?: number }
interface Environment { RELEASE_MANAGER: Pick<ReleaseManager, "renew" | "promote">; SLACK_APP_ID?: string; SLACK_TEAM_ID?: string; SLACK_CHANNEL_ID?: string }
const phases = [10, 25, 75, 100]
const identity = (value: HmdCapability) => value && /^[A-Za-z0-9_-]{1,128}$/.test(value.owner) && phases.includes(value.phase) &&
  /^[a-f0-9]{64}$/.test(value.snapshot) && /^[a-f0-9]{64}$/.test(value.token)
const matches = (record: ReviewRecord | undefined, capability: HmdCapability) => identity(capability) && record &&
  record.owner === capability.owner && record.phase === capability.phase && record.snapshot === capability.snapshot && record.token === capability.token

/** Host-only per-run review record. Callers must authenticate Slack before submitting.
 * Persist consumption BEFORE sending; a lost event acknowledgement is never blindly resent.
 */
export class HmdApprovals extends DurableObject<Environment> {
  #context(destination?: "demo") {
    const { SLACK_APP_ID: app, SLACK_TEAM_ID: team, SLACK_CHANNEL_ID: channel } = this.env
    if (!app || !team || !channel) throw new Error("Review destination is not configured")
    return JSON.stringify(destination ? [app, team, channel, destination] : [app, team, channel])
  }
  register(owner: string, phase: number, snapshot: string, expiresAt: number, sample = 0): Promise<HmdCapability> {
    return this.#register(undefined, owner, phase, snapshot, expiresAt, sample)
  }
  /** A fixed host registration method, not a caller-selected Workflow destination. */
  registerDemo(owner: string, phase: number, snapshot: string, expiresAt: number): Promise<HmdCapability> {
    return this.#register("demo", owner, phase, snapshot, expiresAt, 0)
  }
  #register(destination: "demo" | undefined, owner: string, phase: number, snapshot: string, expiresAt: number, sample: number): Promise<HmdCapability> {
    return this.ctx.storage.transaction(async (tx) => {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner) || !phases.includes(phase) || !/^[a-f0-9]{64}$/.test(snapshot) ||
        !Number.isSafeInteger(sample) || sample < 0 || sample > 20 || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 300_000) throw new Error("Invalid HMD review")
      const previous = await tx.get<ReviewRecord>("review")
      const context = this.#context(destination)
      if (previous && previous.context !== context) throw new Error("Review destination changed")
      if (previous?.owner !== undefined && previous.owner !== owner) throw new Error("Review owner mismatch")
      if (previous?.phase === phase) {
        if (previous.snapshot === snapshot && previous.expiresAt === expiresAt && previous.state === "waiting" && (previous.sample ?? 0) === sample) return { owner, phase, snapshot, token: previous.token }
        if (previous.state !== "refreshing" || previous.expiresAt !== expiresAt || sample !== (previous.sample ?? 0) + 1 || previous.snapshot === snapshot) throw new Error("Review identity changed")
      }
      // Only the trusted controller registers reviews. Clear-health phases may
      // advance without review; require monotonic review phases, not adjacency.
      if (previous && phase !== previous.phase && (phase <= previous.phase || previous.state !== "closed")) throw new Error("Review phase is not ready")
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("")
      const record: ReviewRecord = { owner, phase, snapshot, token, context, expiresAt, sample, state: "waiting", ...(destination ? {destination} : {}) }
      await tx.put("review", record)
      return { owner, phase, snapshot, token }
    })
  }
  async refresh(owner: string, phase: number, snapshot: string): Promise<boolean> {
    return this.ctx.storage.transaction(async (tx) => {
      const record = await tx.get<ReviewRecord>("review")
      if (!record || record.owner !== owner || record.phase !== phase || record.snapshot !== snapshot ||
        record.context !== this.#context(record.destination) || Date.now() >= record.expiresAt) throw new Error("Sampling review is not current")
      if (record.state === "sending" || record.state === "submitted") return false
      if (record.state !== "waiting") throw new Error("Sampling review is not waiting")
      await tx.put("review", { ...record, state: "refreshing" })
      return true
    })
  }
  async inspect(capability: HmdCapability): Promise<boolean> {
    const record = await this.ctx.storage.get<ReviewRecord>("review")
    return Boolean(matches(record, capability) && record!.context === this.#context(record!.destination) && record!.state === "waiting" && Date.now() < record!.expiresAt)
  }
  async close(owner: string): Promise<void> {
    await this.ctx.storage.transaction(async (tx) => {
      const record = await tx.get<ReviewRecord>("review")
      if (!record) return
      if (record.owner !== owner) throw new Error("Review owner mismatch")
      await tx.put("review", { ...record, state: "closed" })
    })
  }
  /** Deadline cannot race a consumed Reject/Progress whose delivery is unresolved. */
  async expire(owner: string, phase: number, snapshot: string): Promise<void> {
    await this.ctx.storage.transaction(async (tx) => {
      const record = await tx.get<ReviewRecord>("review")
      if (!record || record.owner !== owner || record.phase !== phase || record.snapshot !== snapshot ||
        record.context !== this.#context(record.destination) || record.state !== "waiting" || Date.now() < record.expiresAt) {
        throw new Error("Deadline review is unresolved or not current")
      }
      await tx.put("review", { ...record, state: "closed" })
    })
  }
  async submit(capability: HmdCapability, decision: "approved" | "rejected", reason: string, actor: string): Promise<boolean> {
    if (!identity(capability) || !["approved", "rejected"].includes(decision) || typeof reason !== "string" ||
      !reason.trim() || reason.length > 500 || !/^slack:[A-Z0-9]+:[A-Z0-9]+$/.test(actor)) return false
    const accepted = await this.ctx.storage.transaction(async (tx) => {
      const record = await tx.get<ReviewRecord>("review")
      if (!matches(record, capability) || record!.context !== this.#context(record!.destination) || record!.state !== "waiting" || Date.now() >= record!.expiresAt) return false
      await tx.put("review", { ...record, state: "sending", decision, reason, actor, acceptedAt: Date.now() })
      return true
    })
    if (!accepted) return false
    // Acknowledge the consumed intent promptly; Slack requires a response within 3s.
    // Delivery is not retried on ambiguity. The native wait/independent broker alarm
    // still recover if this background operation never acknowledges completion.
    this.ctx.waitUntil(this.#deliver(capability, decision, reason, actor))
    return true
  }
  async #deliver(capability: HmdCapability, decision: "approved" | "rejected", reason: string, actor: string): Promise<void> {
    try {
      // Rejecting needs no promotion capability; approval verifies lease and external drift.
      if (decision === "approved") {
        await this.env.RELEASE_MANAGER.renew(capability.owner)
        await this.env.RELEASE_MANAGER.promote(capability.owner, capability.phase)
      }
      const record = await this.ctx.storage.get<ReviewRecord>("review")
      if (!matches(record, capability) || record!.context !== this.#context(record!.destination)) return
      const host = this.ctx.exports as unknown as { HmdReviewWorkflow: Workflow; DemoCIWorkflow: Workflow }
      const binding = record!.destination === "demo" ? host.DemoCIWorkflow : host.HmdReviewWorkflow
      const instance = await binding.get(capability.owner)
      const status = await instance.status()
      if (status.status !== "running" && status.status !== "waiting") return
      if (!await this.ctx.storage.transaction(async (tx) => {
        const record = await tx.get<ReviewRecord>("review")
        return Boolean(matches(record, capability) && record!.state === "sending" && Date.now() < record!.expiresAt)
      })) return
      await instance.sendEvent({ type: `hmd-review-${capability.phase}`, payload: {
        snapshot: capability.snapshot, decision, reason, actor,
      } })
      await this.ctx.storage.transaction(async (tx) => {
        const record = await tx.get<ReviewRecord>("review")
        if (matches(record, capability) && record!.state === "sending") await tx.put("review", { ...record, state: "submitted" })
      })
    } catch { /* consumed intent remains unresolved; never resend blindly */ }
  }
  /** Private host evidence: an event/actor string alone can never authorize demo progression. */
  async readDemoDecision(owner: string, phase: number, snapshot: string) {
    const r = await this.ctx.storage.get<ReviewRecord>("review")
    if (!r || r.destination !== "demo" || r.context !== this.#context("demo") || r.owner !== owner || r.phase !== phase || r.snapshot !== snapshot ||
        !["sending", "submitted"].includes(r.state) || !r.acceptedAt || r.acceptedAt >= r.expiresAt || Date.now() >= r.expiresAt ||
        !r.reason || !r.actor || !["approved", "rejected"].includes(r.decision ?? "")) throw new Error("No authenticated demo decision")
    return {snapshot:r.snapshot, decision:r.decision!, reason:r.reason, actor:r.actor, acceptedAt:r.acceptedAt}
  }
  fetch() { return new Response("Not found", { status: 404 }) }
}
