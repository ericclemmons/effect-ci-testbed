import { DurableObject } from "cloudflare:workers"
import type { ReleaseManager } from "../../release-manager/src/release-manager.ts"

export interface HmdCapability { readonly owner: string; readonly phase: number; readonly snapshot: string; readonly token: string }
interface ReviewRecord extends HmdCapability { readonly expiresAt: number; readonly state: "waiting" | "sending" | "submitted" | "closed";
  readonly decision?: "approved" | "rejected"; readonly reason?: string; readonly actor?: string; readonly acceptedAt?: number }
interface Environment { RELEASE_MANAGER: Pick<ReleaseManager, "renew" | "promote"> }
const phases = [10, 25, 75, 100]
const identity = (value: HmdCapability) => value && /^[A-Za-z0-9_-]{1,128}$/.test(value.owner) && phases.includes(value.phase) &&
  /^[a-f0-9]{64}$/.test(value.snapshot) && /^[a-f0-9]{64}$/.test(value.token)
const matches = (record: ReviewRecord | undefined, capability: HmdCapability) => identity(capability) && record &&
  record.owner === capability.owner && record.phase === capability.phase && record.snapshot === capability.snapshot && record.token === capability.token

/** Host-only per-run review record. Callers must authenticate Slack before submitting.
 * Persist consumption BEFORE sending; a lost event acknowledgement is never blindly resent.
 */
export class HmdApprovals extends DurableObject<Environment> {
  register(owner: string, phase: number, snapshot: string, expiresAt: number): Promise<HmdCapability> {
    return this.ctx.storage.transaction(async (tx) => {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner) || !phases.includes(phase) || !/^[a-f0-9]{64}$/.test(snapshot) ||
        !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 300_000) throw new Error("Invalid HMD review")
      const previous = await tx.get<ReviewRecord>("review")
      if (previous?.owner !== undefined && previous.owner !== owner) throw new Error("Review owner mismatch")
      if (previous?.phase === phase) {
        if (previous.snapshot !== snapshot || previous.expiresAt !== expiresAt || previous.state !== "waiting") throw new Error("Review identity changed")
        return { owner, phase, snapshot, token: previous.token }
      }
      if (phase !== phases[previous ? phases.indexOf(previous.phase) + 1 : 0] ||
        (previous && previous.state !== "closed")) throw new Error("Review phase is not ready")
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("")
      const record: ReviewRecord = { owner, phase, snapshot, token, expiresAt, state: "waiting" }
      await tx.put("review", record)
      return { owner, phase, snapshot, token }
    })
  }
  async inspect(capability: HmdCapability): Promise<boolean> {
    const record = await this.ctx.storage.get<ReviewRecord>("review")
    return Boolean(matches(record, capability) && record!.state === "waiting" && Date.now() < record!.expiresAt)
  }
  async close(owner: string): Promise<void> {
    await this.ctx.storage.transaction(async (tx) => {
      const record = await tx.get<ReviewRecord>("review")
      if (!record) return
      if (record.owner !== owner) throw new Error("Review owner mismatch")
      await tx.put("review", { ...record, state: "closed" })
    })
  }
  async submit(capability: HmdCapability, decision: "approved" | "rejected", reason: string, actor: string): Promise<boolean> {
    if (!identity(capability) || !["approved", "rejected"].includes(decision) || typeof reason !== "string" ||
      !reason.trim() || reason.length > 500 || !/^slack:[A-Z0-9]+:[A-Z0-9]+$/.test(actor)) return false
    const accepted = await this.ctx.storage.transaction(async (tx) => {
      const record = await tx.get<ReviewRecord>("review")
      if (!matches(record, capability) || record!.state !== "waiting" || Date.now() >= record!.expiresAt) return false
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
      const binding = (this.ctx.exports as unknown as { HmdReviewWorkflow: Workflow }).HmdReviewWorkflow
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
  fetch() { return new Response("Not found", { status: 404 }) }
}
