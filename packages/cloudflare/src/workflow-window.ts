import { reconcileTelemetry } from "./telemetry-cohort.ts"

export interface WorkflowWindow {
  readonly accountId: string
  readonly workflowName: string
  readonly windowId: string
  readonly admissionId: string
  readonly version: string
  readonly from: number
  readonly to: number
  readonly sealedAt: number
  readonly queryLimit: number
  readonly invocations: ReadonlyArray<{
    readonly logicalId: string
    readonly instanceId?: string
    readonly admittedAt: number
    readonly scheduledAt: number
    readonly deadlineAt: number
    readonly trigger: "workflow" | "cron"
    readonly cron?: string
  }>
}

export interface WorkflowInstanceReceipt {
  readonly id: string
  readonly version: string
  readonly readAt: number
  readonly status: "queued" | "running" | "paused" | "waiting" | "waitingForPause" | "rollingBack" | "terminated" | "complete" | "errored"
  readonly startedAt?: number
  readonly endedAt?: number
  readonly trigger?: "unknown" | "api" | "binding" | "event" | "cron"
  readonly scheduledAt?: number
  readonly cron?: string
}

export function validateWorkflowWindow(window: WorkflowWindow) {
  if (typeof window.accountId !== "string" || !/^[a-f0-9]{32}$/.test(window.accountId) ||
    typeof window.workflowName !== "string" || !/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,63}$/.test(window.workflowName) ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(window.windowId) || !/^[a-zA-Z0-9_-]{1,100}$/.test(window.admissionId) ||
    typeof window.version !== "string" || !window.version || window.version.length > 128 || ![window.from, window.to, window.sealedAt].every(Number.isFinite) ||
    window.to <= window.from || window.sealedAt > window.from || !Number.isSafeInteger(window.queryLimit) ||
    window.queryLimit < 1 || window.queryLimit > 10_000 || window.invocations.length > 100 ||
    new Set(window.invocations.map(invocation => invocation.logicalId)).size !== window.invocations.length ||
    new Set(window.invocations.flatMap(invocation => invocation.instanceId ? [invocation.instanceId] : [])).size !== window.invocations.filter(invocation => invocation.instanceId !== undefined).length ||
    new Set(window.invocations.filter(invocation => invocation.trigger === "cron").map(invocation => `${invocation.cron}:${invocation.scheduledAt}`)).size !== window.invocations.filter(invocation => invocation.trigger === "cron").length ||
    window.invocations.some(invocation => typeof invocation.logicalId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(invocation.logicalId) ||
      (invocation.instanceId !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(invocation.instanceId)) ||
      invocation.instanceId === window.admissionId ||
      (invocation.trigger === "workflow" && !invocation.instanceId) ||
      ![invocation.admittedAt, invocation.scheduledAt, invocation.deadlineAt].every(Number.isFinite) ||
      invocation.admittedAt > window.sealedAt || invocation.scheduledAt < window.from || invocation.scheduledAt >= window.to ||
      invocation.deadlineAt <= invocation.scheduledAt || invocation.deadlineAt >= window.to ||
      !["workflow", "cron"].includes(invocation.trigger) ||
      (invocation.trigger === "cron" && (typeof invocation.cron !== "string" || !invocation.cron || invocation.cron.length > 200)) ||
      (invocation.trigger !== "cron" && invocation.cron !== undefined))) throw new Error("Invalid admitted Workflow window")
}

export function sealWorkflowWindow(window: WorkflowWindow): WorkflowWindow {
  validateWorkflowWindow(window)
  return Object.freeze({ ...window, invocations: Object.freeze(window.invocations.map(invocation => Object.freeze({ ...invocation }))) })
}

export async function workflowWindowDigest(window: WorkflowWindow) {
  validateWorkflowWindow(window)
  const encoded = JSON.stringify([window.accountId, window.workflowName, window.windowId, window.admissionId, window.version,
    window.from, window.to, window.sealedAt, window.queryLimit, [...window.invocations].sort((previous, current) =>
      previous.logicalId < current.logicalId ? -1 : previous.logicalId > current.logicalId ? 1 : 0).map(invocation => [
      invocation.logicalId, invocation.instanceId ?? null, invocation.admittedAt, invocation.scheduledAt, invocation.deadlineAt, invocation.trigger, invocation.cron ?? null,
    ])])
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded))
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("")
}

const timestamp = (value: unknown) => {
  if (typeof value !== "string") return NaN
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return Date.parse(value.replace(" ", "T") + "Z")
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return Date.parse(value)
  return NaN
}

export function reconcileWorkflowWindow(window: WorkflowWindow, instances: ReadonlyArray<WorkflowInstanceReceipt>,
  rows: ReadonlyArray<unknown>, observedAt: number, discoveryComplete = true) {
  validateWorkflowWindow(window)
  if (!Number.isFinite(observedAt) || observedAt < window.sealedAt || observedAt > Date.now() ||
    typeof discoveryComplete !== "boolean" || instances.length > 200 || rows.length > 20_000) {
    throw new Error("Invalid Workflow observation budget")
  }
  const admissions = new Map(window.invocations.flatMap(invocation => invocation.instanceId ? [[invocation.instanceId, invocation] as const] : []))
  const metadata = new Map<string, WorkflowInstanceReceipt>()
  const invalidInstances = new Set<string>()
  const logicalInstances = new Map<string, string>()
  const invalidLogical = new Set<string>()
  let rejectedMetadata = 0
  for (const instance of instances) {
    if (!instance || typeof instance !== "object" || typeof instance.id !== "string") { rejectedMetadata++; continue }
    const admission = admissions.get(instance.id) ?? window.invocations.find(invocation => invocation.trigger === "cron" &&
      invocation.instanceId === undefined && instance.trigger === "cron" && invocation.cron === instance.cron && invocation.scheduledAt === instance.scheduledAt)
    const terminal = instance.status === "complete" || instance.status === "errored"
    if (!admission || typeof instance.id !== "string" || !instance.id || instance.id.length > 1024 || /[\u0000-\u001f\u007f]/.test(instance.id) ||
      metadata.has(instance.id) || logicalInstances.has(admission.logicalId) || instance.version !== window.version ||
      (admission.trigger === "cron" && (instance.trigger !== "cron" || instance.cron !== admission.cron || instance.scheduledAt !== admission.scheduledAt)) ||
      !["queued", "running", "paused", "waiting", "waitingForPause", "rollingBack", "terminated", "complete", "errored"].includes(instance.status) ||
      !Number.isFinite(instance.readAt) || instance.readAt < window.sealedAt || instance.readAt > observedAt ||
      (instance.startedAt !== undefined && (!Number.isFinite(instance.startedAt) || instance.startedAt < admission.scheduledAt || instance.startedAt > instance.readAt)) ||
      (terminal && (instance.startedAt === undefined || instance.endedAt === undefined || !Number.isFinite(instance.endedAt) ||
        instance.endedAt < instance.startedAt || instance.endedAt > instance.readAt || instance.endedAt >= window.to)) ||
      (!terminal && instance.endedAt !== undefined)) {
      rejectedMetadata++
      invalidInstances.add(instance.id)
      if (admission) invalidLogical.add(admission.logicalId)
      continue
    }
    admissions.set(instance.id, admission)
    logicalInstances.set(admission.logicalId, instance.id)
    metadata.set(instance.id, instance)
  }
  for (const id of invalidInstances) metadata.delete(id)
  for (const logicalId of invalidLogical) metadata.delete(logicalInstances.get(logicalId) ?? "")
  let lifecycleRows = 0
  const conflicting = new Set<string>()
  const terminalRows: unknown[] = []
  for (const raw of rows) {
    const row = raw as Record<string, unknown> | null
    const admission = row && typeof row.instanceId === "string" ? admissions.get(row.instanceId) : undefined
    const instance = admission && row ? metadata.get(String(row.instanceId)) : undefined
    const time = row ? timestamp(row.timestamp) : NaN
    if (!row || !admission || !instance || row.workflowName !== window.workflowName || row.sampleInterval !== 1 ||
      !Number.isFinite(time) || time < Math.floor(admission.scheduledAt / 1000) * 1000 || time < window.from || time >= window.to) {
      terminalRows.push(undefined)
      continue
    }
    if (row.eventType === "WORKFLOW_START" || row.eventType === "WORKFLOW_RUNNING") {
      lifecycleRows++
      continue
    }
    const healthy = row.eventType === "WORKFLOW_SUCCESS"
    if ((!healthy && row.eventType !== "WORKFLOW_FAILURE") || (healthy ? "complete" : "errored") !== instance.status ||
      instance.endedAt === undefined || Math.floor(time / 1000) !== Math.floor(instance.endedAt / 1000)) {
      if (row.eventType === "WORKFLOW_SUCCESS" || row.eventType === "WORKFLOW_FAILURE") conflicting.add(admission.logicalId)
      terminalRows.push(undefined)
      continue
    }
    terminalRows.push({ id: admission.logicalId, eventId: instance.id, version: instance.version,
      timestamp: time, healthy, sampleInterval: 1 })
  }
  const unambiguous = terminalRows.filter(row => !row || !conflicting.has((row as { id: string }).id))
  const result = window.invocations.length ? reconcileTelemetry({ ...window, ids: window.invocations.map(invocation => invocation.logicalId) }, unambiguous) : {
    sample: { version: window.version, from: window.from, to: window.to, completeThrough: window.from, trials: 0, failures: 0, sampling: "unsampled" as const },
    missing: [] as string[], conflicts: [] as string[], rejected: terminalRows.length,
  }
  const saturated = rows.length >= window.queryLimit
  const complete = discoveryComplete && window.invocations.length > 0 && observedAt >= window.to &&
    window.invocations.every(invocation => (metadata.get(logicalInstances.get(invocation.logicalId) ?? "")?.readAt ?? -Infinity) >= window.to) &&
    !saturated && !rejectedMetadata && !conflicting.size && result.sample.completeThrough === window.to
  const missed: string[] = []
  const pending: string[] = []
  const unknown: string[] = []
  const overdueUnknown: string[] = []
  const met: string[] = []
  for (const admission of window.invocations) {
    const instance = metadata.get(logicalInstances.get(admission.logicalId) ?? "")
    if (!instance) {
      unknown.push(admission.logicalId)
      if (observedAt >= admission.deadlineAt) overdueUnknown.push(admission.logicalId)
    }
    else if (instance.endedAt !== undefined && instance.endedAt <= admission.deadlineAt) met.push(admission.logicalId)
    else if (instance.readAt >= admission.deadlineAt) missed.push(admission.logicalId)
    else pending.push(admission.logicalId)
  }
  return { ...result, conflicts: [...new Set([...result.conflicts, ...conflicting])], sample: { ...result.sample, completeThrough: complete ? window.to : window.from },
    accountId: window.accountId, workflowName: window.workflowName, windowId: window.windowId,
    observedAt, complete, lifecycleRows, saturated, discoveryComplete, rejectedMetadata,
    availability: { status: unknown.length || !discoveryComplete ? "uncertain" as const : missed.length ? "missed" as const :
      pending.length || !window.invocations.length ? "pending" as const : "met" as const, met, missed, pending, unknown, overdueUnknown },
    evidenceSource: "admitted-native-workflow-window" as const }
}
