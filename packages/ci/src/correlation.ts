export interface BackendHandle {
  readonly provider: string
  readonly id: string
}

export interface RunIdentity {
  readonly definitionId: string
  readonly source?: { readonly repository: string; readonly revision: string }
  readonly logicalRunId: string
  readonly workflowAttemptId: string
  readonly workflowAttemptNumber: number
  readonly previousWorkflowAttemptId?: string
  readonly operation: "invocation" | "rerun" | "resume"
  readonly backend?: BackendHandle
}

export interface ExecutionAttempt {
  readonly id: string
  readonly stepId: string
  readonly number: number
  readonly outcome: "running" | "success" | "failure" | "interrupted" | "retried"
  readonly backend?: BackendHandle
}

export interface OutputOrigin {
  readonly kind: "executed" | "retained"
  readonly workflowAttemptId: string
  readonly executionAttemptId?: string
}

export interface EventCorrelation {
  readonly run: RunIdentity
  readonly sequence: number
  readonly outputOrigin?: OutputOrigin
  readonly step?: {
    readonly id: string
    readonly executionAttemptId?: string
    readonly executionAttemptNumber?: number
  }
}

export const executionAttemptId = (workflowAttemptId: string, stepId: string, number: number): string =>
  JSON.stringify([workflowAttemptId, stepId, number])

export const formatRunIdentity = (identity: RunIdentity): string =>
  `${identity.definitionId} · run ${identity.logicalRunId} · workflow attempt ${identity.workflowAttemptNumber} (${identity.workflowAttemptId}) · ${identity.operation}`

export class CorrelationCursor {
  private identity: RunIdentity | undefined
  private readonly sequences = new Map<string, number>()
  private readonly executions = new Map<string, number>()
  private completed = false
  private highWatermark = 0
  private planSequence = 0

  get current(): RunIdentity | undefined { return this.identity }

  accept(event: { readonly type: string; readonly workflowId?: string; readonly stepId?: string; readonly correlation?: EventCorrelation }): boolean {
    const correlation = event.correlation
    if (!correlation) return this.identity === undefined
    const { run, sequence, step } = correlation
    if (!run.logicalRunId || !run.workflowAttemptId || !Number.isSafeInteger(run.workflowAttemptNumber) ||
      run.workflowAttemptNumber < 1 || !Number.isSafeInteger(sequence) || sequence < 1 ||
      (event.workflowId !== undefined && event.workflowId !== run.definitionId) ||
      (step && step.id !== event.stepId) || (step?.executionAttemptId !== undefined && step.executionAttemptNumber === undefined)) return false
    const current = this.identity
    if (current && (run.logicalRunId !== current.logicalRunId || run.definitionId !== current.definitionId ||
      run.workflowAttemptNumber < current.workflowAttemptNumber ||
      (run.workflowAttemptNumber === current.workflowAttemptNumber && run.workflowAttemptId !== current.workflowAttemptId))) return false
    const advancing = !current || run.workflowAttemptNumber > current.workflowAttemptNumber
    if (advancing && event.type !== "workflow.started") return false
    if (advancing) {
      this.sequences.clear()
      this.executions.clear()
      this.completed = false
      this.highWatermark = 0
      this.planSequence = 0
    }
    if (this.completed) return false
    const key = event.stepId === undefined ? "$workflow" : `step:${event.stepId}`
    if (sequence <= (this.sequences.get(key) ?? 0) || sequence <= this.planSequence ||
      (event.stepId === undefined && sequence < this.highWatermark)) return false
    if (step?.executionAttemptNumber !== undefined) {
      const number = step.executionAttemptNumber
      if (!Number.isSafeInteger(number) || number < 1 || number < (this.executions.get(step.id) ?? 0) ||
        step.executionAttemptId !== executionAttemptId(run.workflowAttemptId, step.id, number)) return false
      this.executions.set(step.id, number)
    }
    this.identity = run
    this.sequences.set(key, sequence)
    this.highWatermark = Math.max(this.highWatermark, sequence)
    if (event.type === "workflow.plan") this.planSequence = sequence
    if (event.type === "workflow.completed") this.completed = true
    return true
  }
}
