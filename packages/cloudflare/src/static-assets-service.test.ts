import assert from "node:assert/strict"
import test from "node:test"
import { staticAssetHostError } from "./static-assets-service.ts"
test("host stage diagnostics retain only closed messages and never invoke getters", () => {
  for (const message of ["Static deployment allocation mismatch", "Static Assets API unavailable (HTTP 403)"])
    assert.equal(staticAssetHostError(Error(message)).message, message)
  for (const value of [Error("private-token reflected upstream"), Error("Static Assets API unavailable (HTTP 403) private-token"), { message: "private-token" }])
    assert.equal(staticAssetHostError(value).message, "Static Assets host operation failed")
  let invoked = 0
  const accessor = Object.defineProperty(Error(), "message", { get() { invoked++; return "private-token" } })
  assert.equal(staticAssetHostError(accessor).message, "Static Assets host operation failed")
  assert.equal(invoked, 0)
})
