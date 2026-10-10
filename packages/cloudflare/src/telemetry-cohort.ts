import type { HealthSample } from "./health-gate.ts"

export interface TelemetryManifest {
  readonly version: string
  readonly from: number
  readonly to: number
  /** Immutable trusted controller's CLOSED logical cohort, not observed row IDs. */
  readonly ids: ReadonlyArray<string>
}
interface TerminalRow {
  readonly id: string
  /** Native execution identity: repeated delivery != another invocation/retry. */
  readonly eventId: string
  readonly version: string
  readonly timestamp: number
  readonly healthy: boolean
  readonly sampleInterval: 1
}

/** Reconcile normalized TERMINAL outcomes against every expected logical identity.
 * No general ingestion watermark or sampling correction is inferred. The caller
 * must authenticate the immutable manifest, bound the query to it, and normalize
 * native terminal events (not log lines/DO resets) without inventing event IDs.
 * Complete coverage of this exact cohort is not completeness of ambient traffic.
 */
export function reconcileTelemetry(manifest: TelemetryManifest, rows: ReadonlyArray<unknown>) {
  if (typeof manifest.version !== "string" || !manifest.version || !Number.isFinite(manifest.from) || !Number.isFinite(manifest.to) || manifest.to <= manifest.from ||
    !manifest.ids.length || manifest.ids.length > 100_000 || manifest.ids.some((id) => typeof id !== "string" || !id) ||
    new Set(manifest.ids).size !== manifest.ids.length || rows.length > 200_000) throw new Error("Invalid telemetry manifest or row budget")
  const expected = new Set(manifest.ids)
  const accepted = new Map<string, TerminalRow>()
  const eventOwners = new Map<string, string>()
  const conflicts = new Set<string>()
  let rejected = 0
  for (const raw of rows) {
    const row = raw as TerminalRow | null
    if (!row || typeof row !== "object" || !expected.has(row.id) || typeof row.eventId !== "string" || !row.eventId ||
      row.version !== manifest.version || !Number.isFinite(row.timestamp) || row.timestamp < manifest.from || row.timestamp >= manifest.to ||
      typeof row.healthy !== "boolean" || row.sampleInterval !== 1) { rejected++; continue }
    const previous = accepted.get(row.id)
    const eventOwner = eventOwners.get(row.eventId)
    if (eventOwner !== undefined && eventOwner !== row.id) { conflicts.add(eventOwner); conflicts.add(row.id) }
    else eventOwners.set(row.eventId, row.id)
    if (previous && (previous.eventId !== row.eventId || previous.timestamp !== row.timestamp || previous.healthy !== row.healthy)) conflicts.add(row.id)
    else accepted.set(row.id, { ...row })
  }
  const missing = manifest.ids.filter((id) => !accepted.has(id))
  const values = [...accepted.values()].filter((row) => !conflicts.has(row.id))
  const complete = !missing.length && !conflicts.size && rejected === 0
  const sample: HealthSample = { version: manifest.version, from: manifest.from, to: manifest.to,
    completeThrough: complete ? manifest.to : manifest.from, trials: values.length,
    failures: values.filter((row) => !row.healthy).length, sampling: "unsampled" }
  return { sample, missing, conflicts: [...conflicts], rejected, evidenceSource: "closed-logical-cohort" as const }
}
