import assert from "node:assert/strict"
import test from "node:test"
import { remoteEventUrl, remoteOrigin, remoteRecords } from "./remote-protocol.ts"

test("remote stream handles split records, UTF-8, and a final unterminated record", async () => {
  const bytes = new TextEncoder().encode('{"text":"✓"}\n\n{"type":"workflow_completed"}')
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    },
  })
  const records = []
  for await (const record of remoteRecords(body)) records.push(record)
  assert.deepEqual(records, [{ text: "✓" }, { type: "workflow_completed" }])
})

test("remote stream credentials remain on the configured service origin", () => {
  assert.equal(remoteEventUrl("https://ci.example", "/runs/1/events"), "https://ci.example/runs/1/events")
  for (const url of ["https://evil.example/events", "http://ci.example/events", "https://user:password@ci.example/events"]) {
    assert.throws(() => remoteEventUrl("https://ci.example", url), /configured service origin/)
  }
})

test("execution credentials require HTTPS except for loopback development", () => {
  assert.equal(remoteOrigin("https://ci.example/"), "https://ci.example")
  assert.equal(remoteOrigin("http://127.0.0.1:5173"), "http://127.0.0.1:5173")
  for (const url of ["http://ci.example", "https://user:secret@ci.example", "file:///tmp/ci"]) {
    assert.throws(() => remoteOrigin(url), /HTTPS/)
  }
})
