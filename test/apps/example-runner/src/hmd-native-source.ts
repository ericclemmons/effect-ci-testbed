import { collectReceipts, readReceiptSamples, type ReceiptBatch } from "./wobs-samples.ts"

/** Fixed-target synthetic cohort only. No HTTP outcomes become health observations.
 * logs.workersLogs through Analytics SQL is account-observed experimental behavior,
 * not a documented production binding contract. Never enable it implicitly.
 */
export interface HmdNativeSource {
  capture(versions: ReadonlyArray<string>): Promise<ReceiptBatch>
  read(batches: ReadonlyArray<ReceiptBatch>, versions: ReadonlyArray<string>, from: number, to: number):
    ReturnType<typeof readReceiptSamples>
}

export function nativeHmdSource(query: Parameters<typeof readReceiptSamples>[4],
  capture: HmdNativeSource["capture"] = (versions) => collectReceipts(100, versions)): HmdNativeSource {
  return {
    capture,
    read: (batches, versions, from, to) => {
      if (!batches.length || batches.length > 21 || batches.some(batch => !Number.isSafeInteger(batch.requested) ||
        batch.requested < 1 || !Number.isSafeInteger(batch.unknown) || batch.unknown < 0 ||
        batch.requested !== batch.receipts.length + batch.unknown)) throw new Error("Invalid native HMD batch history")
      // Re-read the same independently captured identities as ingestion catches up.
      // Never replace missing/sampled outcomes with fresh traffic or client status.
      return readReceiptSamples({ receipts: batches.flatMap((batch) => [...batch.receipts]),
        requested: batches.reduce((sum, batch) => sum + batch.requested, 0),
        unknown: batches.reduce((sum, batch) => sum + batch.unknown, 0) }, versions, from, to, query)
    },
  }
}
