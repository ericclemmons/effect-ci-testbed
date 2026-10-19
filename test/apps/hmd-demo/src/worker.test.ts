import { test } from "node:test"
import assert from "node:assert/strict"
import worker from "./worker.ts"

const metadata = { id: "test-version", tag: "test", timestamp: "2026-10-10T00:00:00Z" }
test("demo emits the exact executing version and deterministic extreme profiles", async () => {
  for (const [rate, status] of [["0", 200], ["1", 503]] as const) {
    const response = worker.fetch(new Request("https://example.com/health"), { WORKER_METADATA: metadata, FAILURE_RATE: rate })
    assert.equal(response.status, status)
    assert.equal((await response.json() as { version: string }).version, metadata.id)
  }
})
test("demo has no mutation routes and invalid configuration fails closed", () => {
  assert.equal(worker.fetch(new Request("https://example.com/admin"), { WORKER_METADATA: metadata, FAILURE_RATE: "0" }).status, 404)
  assert.equal(worker.fetch(new Request("https://example.com/health"), { WORKER_METADATA: metadata, FAILURE_RATE: "invalid" }).status, 503)
})
