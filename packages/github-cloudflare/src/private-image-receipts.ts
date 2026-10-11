import { boundedTrustedPng, uploadPrivateSlackImage, type PrivateSlackImageResult } from "./slack-images.ts"

export type ImageStage = "pending" | "allocated" | "uploading" | "uploaded" | "completing" | "complete" | "unresolved"
export interface ImageReceipt {
  readonly fingerprint: string
  readonly stage: ImageStage
  readonly fileId?: string
}
/** reserve MUST atomically create pending or return the existing immutable identity. */
export interface ImageReceiptStore {
  reserve(key: string, fingerprint: string): Promise<{ acquired: true } | { acquired: false; receipt: ImageReceipt }>
  advance(key: string, fingerprint: string, stage: ImageStage, fileId?: string): Promise<void>
}
const digest = async (bytes: Uint8Array): Promise<string> => Array.from(new Uint8Array(
  await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), (byte) => byte.toString(16).padStart(2, "0")).join("")

/**
 * Persist intent before allocation and receipts before returning a usable file ID.
 * Incomplete/lost-ack operations never reallocate or retry external side effects.
 * They retain the last known file ID for operator reconciliation; callers can keep
 * the existing text card. A restarted request cannot prove an upload never happened.
 */
export async function uploadRecordedPrivateImage(
  identity: { runId: string; snapshot: string; destination: string },
  botToken: string,
  png: Uint8Array,
  store: ImageReceiptStore,
  transport: typeof fetch = fetch,
): Promise<PrivateSlackImageResult> {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(identity.runId) || !/^[a-f0-9]{64}$/.test(identity.snapshot) ||
    !/^[A-Z0-9:_-]{1,128}$/.test(identity.destination) || !botToken || !boundedTrustedPng(png)) return { ok: false }
  const bytes = new Uint8Array(png)
  const key = `${identity.runId}:${identity.snapshot}:${identity.destination}`
  // Bind receipt reuse to the same image and credential identity without storing
  // the token in the ledger. Rotation fails closed rather than creating a duplicate.
  const fingerprint = await digest(new TextEncoder().encode(JSON.stringify([
    await digest(bytes), await digest(new TextEncoder().encode(botToken)),
  ])))
  try {
    const reservation = await store.reserve(key, fingerprint)
    if (!reservation.acquired) {
      const receipt = reservation.receipt
      return receipt.fingerprint === fingerprint && receipt.stage === "complete" &&
        typeof receipt.fileId === "string" && /^F[A-Z0-9]+$/.test(receipt.fileId)
        ? { ok: true, fileId: receipt.fileId } : { ok: false }
    }
    let knownFileId: string | undefined
    const result = await uploadPrivateSlackImage(botToken, bytes, transport, async (stage, fileId) => {
      knownFileId = fileId
      await store.advance(key, fingerprint, stage, fileId)
    })
    await store.advance(key, fingerprint, result.ok ? "complete" : "unresolved", result.ok ? result.fileId : knownFileId)
    return result
  } catch {
    // A failed ledger write is itself ambiguous. Leave persisted intent intact;
    // replay cannot perform a second allocation even if completion succeeded.
    return { ok: false }
  }
}
