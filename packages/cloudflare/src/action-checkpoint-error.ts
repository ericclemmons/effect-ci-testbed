/** A native checkpoint acknowledgement is not evidence that its body did nothing. */
export class ActionCheckpointError extends Error {
  readonly stage = "checkpoint-ack" as const
  readonly effects = "unknown" as const
  readonly stepId: string
  constructor(stepId: string) {
    super("Native action checkpoint acknowledgement failed (stage=checkpoint-ack); external effects may already exist. Inspect the retained action and reconcile its exact identity; never retry automatically")
    this.name = "ActionCheckpointError"
    this.stepId = stepId
  }
}

/** Only the fixed provider protocol is translated; no arbitrary cause text/stack is copied. */
export function actionCheckpointError(error: unknown, stepId: string): unknown {
  if (!(error instanceof Error)) return error
  const message = Object.getOwnPropertyDescriptor(error, "message")
  const name = Object.getOwnPropertyDescriptor(error, "name")
  if (!message || !("value" in message) || message.value !== "Attempt failed due to internal workflows error") return error
  // Do not reinterpret subclass policy (notably NonRetryableError) merely
  // because it happens to use the provider's message text.
  if (!name && Object.getPrototypeOf(error) !== Error.prototype) return error
  if (name && (!("value" in name) || !["Error", "WorkflowInternalError"].includes(name.value))) return error
  return new ActionCheckpointError(stepId)
}
