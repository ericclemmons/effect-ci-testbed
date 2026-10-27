export type LifecyclePhase =
  | "dependencies" | "available-compute" | "executor-startup" | "executing"
  | "retry-backoff" | "collecting-evidence" | "awaiting-decision"
  | "succeeded" | "failed" | "cancelled" | "skipped" | "reused"

export type LifecycleOutcome =
  | "success" | "failure" | "cancelled"
  | "rollback-requested" | "rollback-completed" | "rollback-failed"

export type LifecycleEvent =
  | { readonly type: "step.lifecycle"; readonly workflowId: string; readonly stepId: string;
      readonly phase: LifecyclePhase; readonly timestamp: string; readonly deadline?: string }
  | { readonly type: "workflow.lifecycle"; readonly workflowId: string;
      readonly outcome: LifecycleOutcome; readonly timestamp: string }

export const lifecycleLabels: Readonly<Record<LifecyclePhase, string>> = {
  dependencies: "Waiting for dependencies",
  "available-compute": "Waiting for available compute",
  "executor-startup": "Starting executor",
  executing: "Executing",
  "retry-backoff": "Waiting to retry",
  "collecting-evidence": "Collecting evidence",
  "awaiting-decision": "Awaiting authorized decision",
  succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled", skipped: "Skipped", reused: "Reused",
}

export const lifecycleOutcomes: Readonly<Record<LifecycleOutcome, string>> = {
  success: "Passed", failure: "Failed", cancelled: "Cancelled",
  "rollback-requested": "Rollback requested", "rollback-completed": "Rolled back", "rollback-failed": "Rollback failed",
}

export const lifecycleTerminal = (phase: LifecyclePhase): boolean =>
  ["succeeded", "failed", "cancelled", "skipped", "reused"].includes(phase)

export const formatLifecycle = (event: LifecycleEvent): string => event.type === "workflow.lifecycle"
  ? lifecycleOutcomes[event.outcome]
  : `${event.stepId}: ${lifecycleLabels[event.phase]}${event.deadline ? ` until ${event.deadline}` : ""}`

const transitions: Readonly<Record<LifecyclePhase, ReadonlyArray<LifecyclePhase>>> = {
  dependencies: ["available-compute", "executor-startup", "executing", "failed", "cancelled", "skipped", "reused"],
  "available-compute": ["executor-startup", "executing", "failed", "cancelled"],
  "executor-startup": ["executing", "failed", "cancelled", "retry-backoff"],
  executing: ["dependencies", "available-compute", "executor-startup", "retry-backoff", "collecting-evidence", "awaiting-decision", "succeeded", "failed", "cancelled", "skipped", "reused"],
  "retry-backoff": ["executor-startup", "executing", "failed", "cancelled"],
  "collecting-evidence": ["executing", "awaiting-decision", "succeeded", "failed", "cancelled", "retry-backoff"],
  "awaiting-decision": ["executing", "succeeded", "failed", "cancelled", "retry-backoff"],
  succeeded: [], failed: [], cancelled: [], skipped: [], reused: [],
}

export interface LifecycleTiming {
  readonly phase: LifecyclePhase
  readonly timestamp: string
  readonly deadline?: string | undefined
  readonly dependencyMs: number | null
  readonly queueMs: number | null
  readonly startupMs: number | null
  readonly executionMs: number | null
  readonly retryMs: number | null
  readonly evidenceMs: number | null
  readonly decisionMs: number | null
}

const measures = {
  dependencies: "dependencyMs", "available-compute": "queueMs", "executor-startup": "startupMs",
  executing: "executionMs", "retry-backoff": "retryMs", "collecting-evidence": "evidenceMs", "awaiting-decision": "decisionMs",
} as const

export class LifecycleProjection {
  private readonly steps = new Map<string, LifecycleTiming>()
  private workflowId: string | undefined
  private outcomeValue: LifecycleOutcome | undefined
  private outcomeTimestamp = -Infinity
  private stepTimestamp = -Infinity

  get outcome(): LifecycleOutcome | undefined { return this.outcomeValue }
  get terminal(): boolean { return this.outcomeValue !== undefined && this.outcomeValue !== "rollback-requested" }
  step(id: string): LifecycleTiming | undefined { return this.steps.get(id) }

  update(event: LifecycleEvent): boolean {
    const timestamp = Date.parse(event.timestamp)
    if (!Number.isFinite(timestamp) || (this.workflowId !== undefined && this.workflowId !== event.workflowId) || this.terminal) return false
    if (event.type === "workflow.lifecycle") {
      if (timestamp < Math.max(this.outcomeTimestamp, this.stepTimestamp) || event.outcome === this.outcomeValue ||
          (this.outcomeValue === "rollback-requested" && !["rollback-completed", "rollback-failed", "cancelled"].includes(event.outcome))) return false
      this.workflowId = event.workflowId
      this.outcomeValue = event.outcome
      this.outcomeTimestamp = timestamp
      return true
    }
    if (event.deadline !== undefined && (!Number.isFinite(Date.parse(event.deadline)) || Date.parse(event.deadline) < timestamp)) return false
    const previous = this.steps.get(event.stepId)
    if (previous && (timestamp < Date.parse(previous.timestamp) ||
        !transitions[previous.phase].includes(event.phase))) return false
    const next = { dependencyMs: null, queueMs: null, startupMs: null, executionMs: null,
      retryMs: null, evidenceMs: null, decisionMs: null, ...previous,
      phase: event.phase, timestamp: event.timestamp, deadline: event.deadline }
    if (previous && previous.phase in measures) {
      const measure = measures[previous.phase as keyof typeof measures]
      next[measure] = (previous[measure] ?? 0) + timestamp - Date.parse(previous.timestamp)
    }
    this.workflowId = event.workflowId
    this.stepTimestamp = Math.max(this.stepTimestamp, timestamp)
    this.steps.set(event.stepId, Object.freeze(next))
    return true
  }
}
