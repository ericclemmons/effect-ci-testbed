import { DurableObject } from "cloudflare:workers"
import { uploadRecordedPrivateImage, type ImageReceipt, type ImageReceiptStore, type ImageStage } from
  "../../../packages/github-cloudflare/src/private-image-receipts.ts"

interface ImageEnvironment {
  SLACK_BOT_TOKEN?: string
  SLACK_APP_ID?: string
  SLACK_TEAM_ID?: string
  SLACK_CHANNEL_ID?: string
}

/** Host-only binding. No URL, token, or receipt-store binding is given to containers. */
export class PrivateSlackImages extends DurableObject<ImageEnvironment> {
  #store: ImageReceiptStore = {
    reserve: (key, fingerprint) => this.ctx.storage.transaction(async (tx) => {
      const receipt = await tx.get<ImageReceipt>(key)
      if (receipt) return { acquired: false as const, receipt }
      await tx.put(key, { fingerprint, stage: "pending" } satisfies ImageReceipt)
      return { acquired: true as const }
    }),
    advance: (key, fingerprint, stage, fileId) => this.ctx.storage.transaction(async (tx) => {
      const receipt = await tx.get<ImageReceipt>(key)
      const next: Partial<Record<ImageStage, ImageStage>> = {
        pending: "allocated", allocated: "uploading", uploading: "uploaded", uploaded: "completing", completing: "complete",
      }
      if (!receipt || receipt.fingerprint !== fingerprint || receipt.stage === "complete" || receipt.stage === "unresolved" ||
        (stage !== "unresolved" && next[receipt.stage] !== stage) ||
        (receipt.fileId && receipt.fileId !== fileId)) throw new Error("Invalid image receipt transition")
      await tx.put(key, { fingerprint, stage, ...(fileId ? { fileId } : {}) } satisfies ImageReceipt)
    }),
  }

  upload(runId: string, snapshot: string, png: Uint8Array) {
    const { SLACK_APP_ID: app, SLACK_TEAM_ID: team, SLACK_CHANNEL_ID: channel, SLACK_BOT_TOKEN: token } = this.env
    if (!app || !team || !channel || !token) return Promise.resolve({ ok: false as const })
    return uploadRecordedPrivateImage({ runId, snapshot, destination: `${app}:${team}:${channel}` }, token, png, this.#store)
  }
  fetch() { return new Response("Not found", { status: 404 }) }
}
