import assert from "node:assert/strict"
import test from "node:test"
import { uploadRecordedSlackLog } from "./slack-log-snippets.ts"
import type { ImageReceipt, ImageReceiptStore, ImageStage } from "./private-image-receipts.ts"

const identity = { runId: "run-1", stepId: "test", destination: "APP:TEAM:C123", channel: "C123", threadTs: "1234.5678" }
function ledger(failAt?: ImageStage) {
  const records = new Map<string, ImageReceipt>()
  const store: ImageReceiptStore = {
    reserve: async (key, fingerprint) => {
      const receipt = records.get(key)
      if (receipt) return { acquired: false, receipt }
      records.set(key, { fingerprint, stage: "pending" }); return { acquired: true }
    },
    advance: async (key, fingerprint, stage, fileId) => {
      if (stage === failAt) throw Error("Storage interrupted")
      records.set(key, { fingerprint, stage, ...(fileId ? { fileId } : {}) })
    },
  }
  return { store, records }
}
function slack(failure?: "allocation" | "upload" | "completion" | "redirect" | "public") {
  const requests: Array<ReturnType<Request["clone"]>> = []
  const transport = (async (input, init) => {
    const request = new Request(input, init); requests.push(request.clone())
    assert.equal(request.redirect, "manual")
    if (request.url.includes("getUploadURLExternal")) {
      assert.equal(request.headers.get("authorization"), "Bearer secret")
      const form = new URLSearchParams(await request.text())
      assert.equal(form.get("snippet_type"), "text")
      if (failure === "allocation") throw Error("Lost allocation ACK")
      return Response.json({ ok: true, file_id: "F123", upload_url: failure === "redirect"
        ? "https://attacker.invalid/upload/v1/test" : "https://files.slack.com/upload/v1/test" })
    }
    if (request.url.startsWith("https://files.slack.com/")) {
      assert.equal(request.headers.has("authorization"), false)
      assert.equal(await request.text(), "captured output")
      if (failure === "upload") throw Error("Lost upload ACK")
      return new Response("OK")
    }
    const body = await request.json() as Record<string, unknown>
    assert.deepEqual(body, { files: [{ id: "F123", title: "test · captured output" }], channel_id: "C123", thread_ts: "1234.5678" })
    if (failure === "completion") throw Error("Lost completion ACK")
    return Response.json({ ok: true, files: [{ id: "F123", public_url_shared: failure === "public" }] })
  }) as typeof fetch
  return { transport, requests }
}

test("snippet shares only into the owned thread and replays the acknowledged receipt", async () => {
  const { store, records } = ledger(); const api = slack()
  for (let i = 0; i < 3; i++) assert.deepEqual(await uploadRecordedSlackLog(identity, "secret", "captured output", store, api.transport), { ok: true, fileId: "F123" })
  assert.equal(api.requests.length, 3)
  assert.equal([...records.values()][0]?.stage, "complete")
  assert.doesNotMatch(JSON.stringify([...records]), /secret|captured output|https:/)
  for (const change of [{ threadTs: "999.0" }, { channel: "C999" }])
    assert.deepEqual(await uploadRecordedSlackLog({ ...identity, ...change }, "secret", "captured output", store, api.transport), { ok: false })
  assert.deepEqual(await uploadRecordedSlackLog(identity, "secret", "changed output", store, api.transport), { ok: false })
  assert.equal(api.requests.length, 3)
})

test("ambiguous allocation, upload, completion and storage failure never allocate twice", async () => {
  for (const failure of ["allocation", "upload", "completion", "redirect", "public"] as const) {
    const { store } = ledger(); const api = slack(failure)
    assert.deepEqual(await uploadRecordedSlackLog(identity, "secret", "captured output", store, api.transport), { ok: false })
    const count = api.requests.length
    assert.deepEqual(await uploadRecordedSlackLog(identity, "secret", "captured output", store, api.transport), { ok: false })
    assert.equal(api.requests.length, count)
  }
  for (const stage of ["allocated", "uploading", "uploaded", "completing", "complete"] as const) {
    const { store } = ledger(stage); const api = slack()
    await uploadRecordedSlackLog(identity, "secret", "captured output", store, api.transport)
    const count = api.requests.length
    assert.deepEqual(await uploadRecordedSlackLog(identity, "secret", "captured output", store, api.transport), { ok: false })
    assert.equal(api.requests.length, count)
  }
})

test("invalid destinations and oversized retained output create no upload intent", async () => {
  const { store, records } = ledger(); const api = slack()
  for (const change of [{ channel: "@channel" }, { threadTs: "x" }, { runId: "../run" }, { stepId: "" }])
    assert.deepEqual(await uploadRecordedSlackLog({ ...identity, ...change }, "secret", "captured output", store, api.transport), { ok: false })
  assert.deepEqual(await uploadRecordedSlackLog(identity, "secret", "x".repeat(72_001), store, api.transport), { ok: false })
  assert.equal(records.size, 0); assert.equal(api.requests.length, 0)
})
