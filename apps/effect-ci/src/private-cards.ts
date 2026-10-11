import { DurableObject } from "cloudflare:workers"
import { publishOwnedSlackCard, type OwnedCardEnvironment, type OwnedCardFrame, type OwnedCardReceipt, type OwnedCardStore } from
  "../../../packages/github-cloudflare/src/owned-slack-card.ts"

/** One object per run. Binding and notification credentials stay outside containers. */
export class PrivateSlackCards extends DurableObject<OwnedCardEnvironment> {
  #store: OwnedCardStore = {
    reserve: (intent) => this.ctx.storage.transaction(async (tx) => {
      const previous = await tx.get<OwnedCardReceipt>("card")
      if (previous && (previous.owner !== intent.owner || previous.destination !== intent.destination ||
        previous.stage !== "complete" || previous.sequence >= intent.sequence)) return { acquired: false as const, receipt: previous }
      await tx.put("card", { ...intent, ...(previous?.ts ? { ts: previous.ts } : {}) })
      return { acquired: true as const, ...(previous?.ts ? { ts: previous.ts } : {}) }
    }),
    complete: (intent, ts) => this.ctx.storage.transaction(async (tx) => {
      const current = await tx.get<OwnedCardReceipt>("card")
      if (!current || current.stage !== "pending" || current.owner !== intent.owner || current.sequence !== intent.sequence ||
        current.destination !== intent.destination || current.fingerprint !== intent.fingerprint ||
        (current.ts && current.ts !== ts)) throw new Error("Invalid owned card receipt")
      await tx.put("card", { ...current, stage: "complete", ts })
    }),
  }
  publish(owner: string, sequence: number, frame: OwnedCardFrame) {
    return publishOwnedSlackCard(owner, sequence, frame, this.env, this.#store)
  }
  fetch() { return new Response("Not found", { status: 404 }) }
}
