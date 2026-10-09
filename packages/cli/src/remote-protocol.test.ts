import assert from "node:assert/strict"
import test from "node:test"
import { remoteEventUrl, remoteRecords } from "./remote-protocol.ts"

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
