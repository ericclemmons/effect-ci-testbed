const ORIGIN = "https://effect-ci-hmd-demo.ericclemmons.workers.dev"

/** Normalize native terminal fetch events, NOT console logs or reset/retry lines.
 * The caller must supply the actual row's sampling interval; absent sampling is
 * unknown, not an implicit 1. Raw request metadata never leaves this adapter.
 * This shape is the observed WOBS telemetry API, not a guessed SQL column mapping.
 */
export function nativeFetchOutcome(raw: unknown, sampleInterval: unknown) {
  if (!raw || typeof raw !== "object" || sampleInterval !== 1) return undefined
  const value = raw as Record<string, any>
  const workers = value.$workers
  const metadata = value.$metadata
  if (metadata?.type !== "cf-worker-event" || typeof metadata.requestId !== "string" || !metadata.requestId ||
    workers?.scriptName !== "effect-ci-hmd-demo" || workers.eventType !== "fetch" ||
    workers.executionModel !== "stateless" || workers.truncated !== false ||
    typeof workers.scriptVersion?.id !== "string" || !workers.scriptVersion.id ||
    !Number.isFinite(value.timestamp) || workers.event?.request?.method !== "GET") return undefined
  const url = workers.event.request.url
  if (typeof url !== "string") return undefined
  let parsed: URL
  try { parsed = new URL(url) } catch { return undefined }
  const id = metadata.rayId
  if (typeof id !== "string" || !/^[a-f0-9]{16}$/.test(id) || parsed.origin !== ORIGIN || parsed.pathname !== "/health" || parsed.username || parsed.password) return undefined
  const status = workers.event?.response?.status
  // Runtime "ok" means the handler returned; an application 503 is still failure.
  // Unrecognized outcomes/statuses are missing evidence, never healthy defaults.
  let healthy: boolean
  if (workers.outcome === "ok" && status === 200) healthy = true
  else if (workers.outcome === "ok" && Number.isInteger(status) && status >= 500 && status <= 599) healthy = false
  else if (["exception", "exceededCpu", "exceededMemory"].includes(workers.outcome)) healthy = false
  else return undefined
  return { id, eventId: metadata.requestId as string, version: workers.scriptVersion.id as string,
    timestamp: value.timestamp as number, healthy, sampleInterval: 1 as const }
}

/** Observed logs.workersLogs columns/attributes. Only native fields are projected;
 * application hmd.outcome or message text cannot manufacture terminal success.
 */
export function sqlFetchOutcome(raw: unknown) {
  if (!raw || typeof raw !== "object") return undefined
  const row = raw as Record<string, any>
  const attributes = row.attributes ?? {}
  const timestamp = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : row.timestamp
  return nativeFetchOutcome({ timestamp, $metadata: { type: row.logType, requestId: row.requestId, rayId: row.rayId },
    $workers: { scriptName: row.scriptName, eventType: attributes["$workers.eventType"],
      executionModel: attributes["$workers.executionModel"], truncated: attributes["$workers.truncated"],
      scriptVersion: { id: attributes["$workers.scriptVersion.id"] }, outcome: attributes["$workers.outcome"],
      event: { request: { method: attributes["$workers.event.request.method"], url: attributes["$workers.event.request.url"] },
        response: { status: attributes["$workers.event.response.status"] } } } }, row.sampleInterval)
}
