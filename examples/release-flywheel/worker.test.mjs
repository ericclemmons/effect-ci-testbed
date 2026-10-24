import assert from "node:assert/strict"
import test from "node:test"
import worker from "./worker.mjs"

test("health identifies the deployed version and prevents response caching", async () => {
  const response = worker.fetch(new Request("https://example.test/health"), { WORKER_METADATA: { id: "candidate" } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.deepEqual(await response.json(), { version: "candidate", healthy: true })
})
test("missing identity fails closed and other paths are unavailable", () => {
  assert.equal(worker.fetch(new Request("https://example.test/health"), {}).status, 503)
  assert.equal(worker.fetch(new Request("https://example.test/admin"), {}).status, 404)
})
