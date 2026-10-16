import assert from "node:assert/strict"
import test from "node:test"
import { deliverReviewPresentation, NotificationDeliveryUnavailable } from "./notification-delivery.ts"

test("only typed presentation unavailability leaves review authority/deadline to the controller", async () => {
  let attempts = 0
  await deliverReviewPresentation(async () => { attempts++; throw new NotificationDeliveryUnavailable() })
  assert.equal(attempts, 1)
  for (const error of [Error("identity mismatch"), Error("Invalid HMD card identity"),
    Error("private record write failed"), Error("Host finalization notification needs reconciliation"),
    { _tag: "NotificationDeliveryUnavailable" }]) {
    await assert.rejects(deliverReviewPresentation(async () => { throw error }), e => e === error)
  }
  const error = new NotificationDeliveryUnavailable()
  assert.doesNotMatch(JSON.stringify(error), /token|channel|webhook|cause/)
  assert.equal(error.reconciliationRequired, true)
})
