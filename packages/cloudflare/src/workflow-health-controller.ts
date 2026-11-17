import type { WorkflowStep } from "cloudflare:workers"
import { evaluateHealth, type HealthDecision, type HealthPolicy } from "./health-gate.ts"
import { reconcileWorkflowWindow, sealWorkflowWindow, workflowWindowDigest, type WorkflowWindow, type WorkflowInstanceReceipt } from "./workflow-window.ts"

export interface WorkflowAdmissionReceipt {
  readonly id: string
  readonly createdAt: number
  readonly digest: string
}

export interface WorkflowHealthSource {
  read(window: WorkflowWindow, sequence: number): Promise<{
    readonly accountId: string
    readonly workflowName: string
    readonly windowId: string
    readonly version: string
    readonly from: number
    readonly to: number
    readonly queryLimit: number
    readonly discoveryComplete: boolean
    readonly admission: WorkflowAdmissionReceipt
    readonly instances: ReadonlyArray<WorkflowInstanceReceipt>
    readonly rows: ReadonlyArray<unknown>
    readonly observedAt: number
  }>
}

export interface WorkflowHealthObservation {
  readonly owner: string
  readonly sequence: number
  readonly evidenceSource: "admitted-native-workflow-window"
  readonly previousWindow: WorkflowWindow
  readonly currentWindow: WorkflowWindow
  readonly previous?: ReturnType<typeof reconcileWorkflowWindow>
  readonly current?: ReturnType<typeof reconcileWorkflowWindow>
  readonly decision: HealthDecision
  readonly unavailable: boolean
}

export interface WorkflowHealthDelivery {
  readonly delivered: number
  readonly failed: number
  readonly slackMessageTs?: string
  readonly discordMessageId?: string
}

export async function runWorkflowHealthController(owner: string, step: WorkflowStep,
  windows: { readonly previous: WorkflowWindow; readonly current: WorkflowWindow }, policy: HealthPolicy,
  source: WorkflowHealthSource, notify: (observation: WorkflowHealthObservation) => Promise<WorkflowHealthDelivery>) {
  const previous = sealWorkflowWindow(windows.previous)
  const current = sealWorkflowWindow(windows.current)
  const pinnedPolicy = structuredClone(policy)
  if (!owner || previous.accountId !== current.accountId || previous.workflowName !== current.workflowName ||
    previous.windowId === current.windowId || previous.to > current.from ||
    previous.version !== pinnedPolicy.baselineVersion || current.version !== pinnedPolicy.candidateVersion ||
    previous.from !== pinnedPolicy.baselineWindow.from || previous.to !== pinnedPolicy.baselineWindow.to || current.from !== pinnedPolicy.phaseStartedAt) {
    throw new Error("Workflow health controller identity mismatch")
  }
  const observations: WorkflowHealthObservation[] = []
  const deliveries: Array<{ readonly status: "delivered" | "unavailable"; readonly receipt?: WorkflowHealthDelivery }> = []
  for (let sequence = 0; sequence < 3; sequence++) {
    let snapshots: Awaited<ReturnType<WorkflowHealthSource["read"]>>[] | undefined
    try { snapshots = await Promise.all([source.read(previous, sequence), source.read(current, sequence)]) }
    catch { snapshots = undefined }
    const observation = await step.do(`workflow-health:read-${sequence}`, { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" }, async () => {
      const identity = { owner, sequence, evidenceSource: "admitted-native-workflow-window" as const, previousWindow: previous, currentWindow: current }
      if (!snapshots) return { ...identity, decision: { status: "uncertain" as const, reason: "native Workflow evidence unavailable" }, unavailable: true }
      for (const [window, snapshot] of [[previous, snapshots.at(0)!], [current, snapshots.at(1)!]] as const) {
        if (!snapshot || !Array.isArray(snapshot.instances) || !Array.isArray(snapshot.rows) || snapshot.instances.length > 200 || snapshot.rows.length > 20_000 ||
          !Number.isFinite(snapshot.observedAt) || snapshot.observedAt > Date.now() || snapshot.observedAt < window.sealedAt ||
          snapshot.accountId !== window.accountId || snapshot.workflowName !== window.workflowName || snapshot.windowId !== window.windowId ||
          snapshot.version !== window.version || snapshot.from !== window.from || snapshot.to !== window.to || snapshot.queryLimit !== window.queryLimit ||
          typeof snapshot.discoveryComplete !== "boolean" || snapshot.admission?.id !== window.admissionId ||
          !Number.isFinite(snapshot.admission.createdAt) || snapshot.admission.createdAt < window.sealedAt || snapshot.admission.createdAt > window.from ||
          snapshot.admission.digest !== await workflowWindowDigest(window)) {
          return { ...identity, decision: { status: "uncertain" as const, reason: "native Workflow evidence identity mismatch" }, unavailable: true }
        }
      }
      const [previousSnapshot, currentSnapshot] = snapshots
      const previousEvidence = reconcileWorkflowWindow(previous, previousSnapshot!.instances, previousSnapshot!.rows, previousSnapshot!.observedAt, previousSnapshot!.discoveryComplete)
      const currentEvidence = reconcileWorkflowWindow(current, currentSnapshot!.instances, currentSnapshot!.rows, currentSnapshot!.observedAt, currentSnapshot!.discoveryComplete)
      const terminalDecision = previous.version === current.version ? { status: "uncertain" as const, reason: "same Workflow version; not a release comparison" } :
        evaluateHealth(previousEvidence.sample, currentEvidence.sample, pinnedPolicy)
      return { ...identity, previous: previousEvidence, current: currentEvidence,
        decision: terminalDecision.status === "advance" && (previousEvidence.availability.status !== "met" || currentEvidence.availability.status !== "met") ?
          { status: "uncertain" as const, reason: "completion deadlines not met; separate availability signal" } : terminalDecision, unavailable: false }
    })
    observations.push(observation)
    const delivery = await step.do(`workflow-health:notify-${sequence}`, { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" }, async () => {
      try {
        const receipt = await notify(structuredClone(observation))
        return receipt.delivered > 0 && receipt.failed === 0 ? { status: "delivered" as const, receipt } : { status: "unavailable" as const }
      }
      catch { return { status: "unavailable" as const } }
    })
    deliveries.push(delivery)
    if (observation.decision.status !== "uncertain") break
    if (sequence < 2) await step.sleep(`workflow-health:ingestion-${sequence}`, "30 seconds")
  }
  return { status: observations.at(-1)!.decision.status, observations, deliveries }
}
