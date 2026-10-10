import { reconcileTelemetry } from "../../../packages/cloudflare/src/telemetry-cohort.ts"
import type { HealthSample } from "../../../packages/cloudflare/src/health-gate.ts"
import { sqlFetchOutcome } from "./wobs-cohort.ts"

export interface NativeReceipt { readonly ray: string; readonly version: string }
export interface ReceiptBatch { readonly receipts: ReadonlyArray<NativeReceipt>; readonly requested: number; readonly unknown: number }
type Query = (input: { query: string; params: Record<string, string> }) => Promise<{ data: ReadonlyArray<Record<string, unknown>> }>
const ORIGIN = "https://effect-ci-hmd-demo.ericclemmons.workers.dev"

/** Independent platform receipts, captured before querying. HTTP outcome is not the health sample. */
export async function collectReceipts(count: number, versions: ReadonlyArray<string>, transport: typeof fetch = fetch): Promise<ReceiptBatch> {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error("Invalid receipt budget")
  const receipts: NativeReceipt[] = []
  let unknown = 0
  for (let index = 0; index < count; index += 5) {
    await Promise.all(Array.from({ length: Math.min(5, count - index) }, async () => {
      try {
        const response = await transport(`${ORIGIN}/health`, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "cache-control": "no-cache" } })
        const body = await response.json() as { version?: string; healthy?: boolean }
        const ray = response.headers.get("cf-ray")?.split("-")[0]
        if (!ray || !/^[a-f0-9]{16}$/.test(ray) || !body.version || !versions.includes(body.version) ||
          typeof body.healthy !== "boolean" || response.status !== (body.healthy ? 200 : 503)) throw new Error("Unknown native receipt")
        receipts.push({ ray, version: body.version })
      } catch { unknown++ }
    }))
  }
  return { receipts, requested: count, unknown }
}

/** Exact native outcomes for a closed, independently recorded mixed-version batch. */
export async function readReceiptSamples(batch: ReceiptBatch, versions: ReadonlyArray<string>, from: number, to: number, query: Query) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || batch.receipts.length > 100 ||
    !Number.isSafeInteger(batch.requested) || batch.requested < 1 || batch.requested > 100 ||
    !Number.isSafeInteger(batch.unknown) || batch.unknown < 0 || batch.unknown + batch.receipts.length !== batch.requested ||
    new Set(batch.receipts.map((r) => r.ray)).size !== batch.receipts.length ||
    batch.receipts.some((r) => !/^[a-f0-9]{16}$/.test(r.ray) || !versions.includes(r.version)) ||
    !versions.length || versions.some((v) => typeof v !== "string" || !v) || new Set(versions).size !== versions.length) throw new Error("Invalid closed receipt cohort")
  if (!batch.receipts.length) return { complete: false, samples: Object.fromEntries(versions.map((version) => [version,
    { version, from, to, completeThrough: from, trials: 0, failures: 0, sampling: "unsampled" as const }])),
    missing: batch.requested, conflicts: 0, invalid: 0, nativeRows: 0 }
  const result = await query({
    query: `SELECT timestamp, scriptName, logType, requestId, rayId, sampleInterval, attributes FROM logs.workersLogs WHERE scriptName = $script AND timestamp >= $from AND timestamp < $to AND rayId IN (${batch.receipts.map((_, index) => `$ray${index}`).join(",")}) LIMIT 500`,
    params: { script: "effect-ci-hmd-demo", from: new Date(from).toISOString(), to: new Date(to).toISOString(),
      ...Object.fromEntries(batch.receipts.map((receipt, index) => [`ray${index}`, receipt.ray])) },
  })
  const expected = new Map(batch.receipts.map((receipt) => [receipt.ray, receipt.version]))
  const native = result.data.filter((row) => row.logType === "cf-worker-event")
  const rows = native.map(sqlFetchOutcome)
  let invalid = rows.filter((row) => !row || expected.get(row.id) !== row.version).length
  const eventOwners = new Map<string, string>()
  for (const row of rows) if (row) {
    const previous = eventOwners.get(row.eventId)
    if (previous && previous !== row.id) invalid++
    else eventOwners.set(row.eventId, row.id)
  }
  const samples: Record<string, HealthSample> = {}
  let complete = invalid === 0 && batch.unknown === 0 && batch.requested === batch.receipts.length
  let missing = 0
  let conflicts = 0
  for (const version of versions) {
    const ids = batch.receipts.filter((r) => r.version === version).map((r) => r.ray)
    if (!ids.length) {
      samples[version] = { version, from, to, completeThrough: from, trials: 0, failures: 0, sampling: "unsampled" }
      continue
    }
    const reconciled = reconcileTelemetry({ version, from, to, ids }, rows.filter((row) => row?.version === version))
    samples[version] = reconciled.sample
    missing += reconciled.missing.length
    conflicts += reconciled.conflicts.length
    complete &&= reconciled.sample.completeThrough === to
  }
  for (const version of versions) samples[version] = { ...samples[version]!, completeThrough: complete ? to : from }
  return { complete, samples, missing, conflicts, invalid, nativeRows: native.length }
}

export function combineSamples(samples: ReadonlyArray<HealthSample>, version: string, from: number, to: number): HealthSample {
  return { version, from, to, sampling: "unsampled", completeThrough: samples.length && samples.every((s) =>
    s.version === version && s.completeThrough === s.to && s.sampling === "unsampled") ? to : from,
    trials: samples.reduce((n, s) => n + s.trials, 0), failures: samples.reduce((n, s) => n + s.failures, 0) }
}
