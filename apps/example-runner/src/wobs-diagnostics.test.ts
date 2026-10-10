import assert from "node:assert/strict"
import test from "node:test"
import { nativeDiagnostics } from "./wobs-diagnostics.ts"

test("native diagnostics expose only counts and preserve unknown or sampled outcomes", () => {
  const result = nativeDiagnostics([{ sampleInterval: 10, attributes: { token: "private" }, rayId: "private-ray" },
    { sampleInterval: 1 }, { sampleInterval: undefined }, { sampleInterval: "1" }])
  assert.deepEqual(result.weights, { "1": 1, "10": 1 })
  assert.equal(result.unknownWeight, 2)
  assert.equal(result.valid, 0)
  assert.equal(result.rejected, 4)
  assert.equal(JSON.stringify(result).includes("private"), false)
})
