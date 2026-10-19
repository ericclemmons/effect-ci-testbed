import assert from "node:assert/strict"
import test from "node:test"
import { hmdFailureReason } from "./hmd-failure.ts"

test("safe broker reason is quoted without credentials or arbitrary error bodies", () => {
  assert.equal(hmdFailureReason(new Error("Release API request failed (transport)")), "Release API request failed (transport): could not connect to Cloudflare.")
  assert.equal(hmdFailureReason(new Error("Release API request failed (response, HTTP 403)")), "Release API request failed (response, HTTP 403).")
  assert.equal(hmdFailureReason(new Error("Release API request failed (transport) token=SECRET")), "Release operation failed; see Details.")
  assert.equal(hmdFailureReason(new Error("Progression deadline cannot accept this stage")), "Progression deadline cannot accept this stage")
  assert.equal(hmdFailureReason(new Error("SECRET")), "Release operation failed; see Details.")
  let read = false
  const error = Object.defineProperty({}, "message", { get() { read = true; return "SECRET" } })
  assert.equal(hmdFailureReason(error), "Release operation failed; see Details.")
  assert.equal(read, false)
})
