import { DurableObject } from "cloudflare:workers"
import { publishOwnedSlackCard, ownedCardDestination, type OwnedCardEnvironment, type OwnedCardFrame, type OwnedCardReceipt, type OwnedCardStore } from
  "../../../packages/github-cloudflare/src/owned-slack-card.ts"

/** One object per run. Binding and notification credentials stay outside containers. */
export class PrivateSlackCards extends DurableObject<OwnedCardEnvironment> {
  #storeFor(key: string): OwnedCardStore { return {
    reserve: (intent) => this.ctx.storage.transaction(async (tx) => {
      const previous = await tx.get<OwnedCardReceipt>(key)
      if (previous && (previous.owner !== intent.owner || previous.destination !== intent.destination ||
        previous.stage !== "complete" || previous.sequence >= intent.sequence)) return { acquired: false as const, receipt: previous }
      if (previous?.stage === "complete" && previous.fingerprint === intent.fingerprint) {
        const unchanged = { ...previous, sequence: intent.sequence }
        await tx.put(key, unchanged)
        return { acquired: false as const, receipt: unchanged }
      }
      await tx.put(key, { ...intent, ...(previous?.ts ? { ts: previous.ts } : {}) })
      return { acquired: true as const, ...(previous?.ts ? { ts: previous.ts } : {}) }
    }),
    complete: (intent, ts) => this.ctx.storage.transaction(async (tx) => {
      const current = await tx.get<OwnedCardReceipt>(key)
      if (!current || current.stage !== "pending" || current.owner !== intent.owner || current.sequence !== intent.sequence ||
        current.destination !== intent.destination || current.fingerprint !== intent.fingerprint ||
        (current.ts && current.ts !== ts)) throw new Error("Invalid owned card receipt")
      await tx.put(key, { ...current, stage: "complete", ts })
    }),
  } }
  publish(owner: string, sequence: number, frame: OwnedCardFrame) {
    return publishOwnedSlackCard(owner, sequence, frame, this.env, this.#storeFor("card"))
  }
  async publishExisting(owner: string, sequence: number, frame: OwnedCardFrame) {
    const parent = await this.ctx.storage.get<OwnedCardReceipt>("card")
    if (!parent || parent.owner !== owner || parent.stage !== "complete" || !parent.ts ||
      parent.destination !== await ownedCardDestination(this.env)) return { ok: false as const }
    return this.publish(owner, sequence, frame)
  }
  async publishThread(owner: string, stage: string, sequence: number, frame: OwnedCardFrame) {
    if (!/^(prepare|previous|10|25|75|100|restored)$/.test(stage)) return { ok: false as const }
    const parent = await this.ctx.storage.get<OwnedCardReceipt>("card")
    if (!parent || parent.owner !== owner || parent.stage !== "complete" || !parent.ts ||
      parent.destination !== await ownedCardDestination(this.env)) return { ok: false as const }
    return publishOwnedSlackCard(owner, sequence, frame, this.env, this.#storeFor(`thread:${stage}`), fetch, undefined, parent.ts)
  }
  fetch() { return new Response("Not found", { status: 404 }) }
}
