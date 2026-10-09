import assert from "node:assert/strict"
import test from "node:test"
import worker from "../src/worker.ts"

test("health endpoint reports readiness", async () => {
  const response = worker.fetch(new Request("https://example.com/health"))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { healthy: true })
})

test("unknown routes return 404", () => {
  assert.equal(worker.fetch(new Request("https://example.com/missing")).status, 404)
})
