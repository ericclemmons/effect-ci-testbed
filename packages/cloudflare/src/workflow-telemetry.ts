import { reconcileTelemetry, type TelemetryManifest } from "./telemetry-cohort.ts"

export interface WorkflowTerminalManifest extends TelemetryManifest {
  readonly workflowName: string
  /** Trusted, independently recorded native instance metadata, not SQL-derived IDs.
   * version is a Workflow version ID, NOT a Worker script version ID.
   */
  readonly instances: ReadonlyArray<{ readonly id: string; readonly version: string;
    readonly status: "complete" | "errored"; readonly endedAt: number }>
  readonly queryLimit: number
}

const timestamp = (value: unknown): number => {
  if (typeof value !== "string") return NaN
  // Analytics DateTime output is UTC at second precision; don't let the
  // operator's local timezone reinterpret an unqualified database timestamp.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return Date.parse(value.replace(" ", "T") + "Z")
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return Date.parse(value)
  return NaN
}

/** events.workflows terminal outcomes for an authenticated CLOSED logical cohort.
 * START/RUNNING are lifecycle updates, not failed trials. Native instance metadata
 * supplies version attribution absent from SQL. Conflicting/restarted terminal
 * histories remain incomplete; query time is never an ingestion watermark.
 */
export function reconcileWorkflowTelemetry(manifest: WorkflowTerminalManifest, rows: ReadonlyArray<unknown>) {
  const ids = new Set(manifest.ids)
  if (!manifest.workflowName || !Number.isSafeInteger(manifest.queryLimit) || manifest.queryLimit < 1 || manifest.queryLimit > 100_000 ||
    rows.length > 200_000 || manifest.instances.length !== manifest.ids.length || new Set(manifest.instances.map(i => i.id)).size !== manifest.ids.length ||
    manifest.instances.some(i => !ids.has(i.id) || i.version !== manifest.version ||
      !["complete", "errored"].includes(i.status) || !Number.isFinite(i.endedAt) || i.endedAt < manifest.from || i.endedAt >= manifest.to)) {
    throw new Error("Invalid native Workflow terminal manifest")
  }
  const metadata = new Map(manifest.instances.map(i => [i.id, i]))
  const terminal: unknown[] = []
  let lifecycleRows = 0
  for (const raw of rows) {
    const row = raw as Record<string, unknown> | null
    const instance = row && typeof row.instanceId === "string" ? metadata.get(row.instanceId) : undefined
    const time = row ? timestamp(row.timestamp) : NaN
    if (!row || !instance || row.workflowName !== manifest.workflowName || !Number.isFinite(time) || time < manifest.from || time >= manifest.to) {
      terminal.push(undefined); continue
    }
    if (["WORKFLOW_START", "WORKFLOW_RUNNING"].includes(String(row.eventType))) { lifecycleRows++; continue }
    const healthy = row.eventType === "WORKFLOW_SUCCESS"
    if ((!healthy && row.eventType !== "WORKFLOW_FAILURE") || row.sampleInterval !== 1 ||
      (healthy ? "complete" : "errored") !== instance.status || Math.floor(time / 1000) !== Math.floor(instance.endedAt / 1000)) {
      terminal.push(undefined); continue
    }
    terminal.push({ id: instance.id, eventId: instance.id, version: instance.version,
      timestamp: time, healthy, sampleInterval: 1 })
  }
  const result = reconcileTelemetry(manifest, terminal)
  const saturated = rows.length >= manifest.queryLimit
  return { ...result, sample: { ...result.sample, completeThrough: saturated ? manifest.from : result.sample.completeThrough },
    lifecycleRows, saturated, evidenceSource: "closed-native-workflow-cohort" as const }
}
