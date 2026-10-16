/** Presentation transport/checkpoint availability only, never identity or approval authority. */
export class NotificationDeliveryUnavailable extends Error {
  readonly _tag = "NotificationDeliveryUnavailable"
  readonly reconciliationRequired = true
  constructor() {
    super("Maintained notification delivery unavailable; reconcile the same message. No automatic repost or approval.")
    this.name = "NotificationDeliveryUnavailable"
  }
}

/** Keep the decision wait/deadline authoritative without swallowing validation errors. */
export async function deliverReviewPresentation(deliver: () => Promise<void>): Promise<void> {
  try { await deliver() }
  catch (error) {
    if (!(error instanceof NotificationDeliveryUnavailable)) throw error
    console.warn("Review notification unavailable; authorized decision or deadline still required")
  }
}
