import assert from "node:assert/strict"
import test from "node:test"
import { uploadRecordedPrivateImage, type ImageReceipt, type ImageReceiptStore, type ImageStage } from "./private-image-receipts.ts"

const identity = { runId: "hmd-run-1", snapshot: "a".repeat(64), destination: "APP:TEAM:CHANNEL" }
const png = () => {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13); view.setUint32(12, 0x49484452); view.setUint32(16, 760); view.setUint32(20, 350)
  return bytes
}
function ledger(failAt?: ImageStage) {
  const records = new Map<string, ImageReceipt>()
  const stages: ImageStage[] = []
  const store: ImageReceiptStore = {
    reserve: async (key, fingerprint) => {
      const receipt = records.get(key)
      if (receipt) return { acquired: false, receipt }
      records.set(key, { fingerprint, stage: "pending" }); stages.push("pending")
      return { acquired: true }
    },
    advance: async (key, fingerprint, stage, fileId) => {
      if (stage === failAt) throw new Error("Storage interrupted")
      records.set(key, { fingerprint, stage, ...(fileId ? { fileId } : {}) }); stages.push(stage)
    },
  }
  return { store, records, stages }
}
function slack() {
  let calls = 0
  const transport = (async () => {
    calls++
    if (calls === 1) return Response.json({ ok: true, file_id: "F123", upload_url: "https://files.slack.com/upload/v1/test" })
    if (calls === 2) return new Response("OK")
    return Response.json({ ok: true, files: [{ id: "F123", is_public: false }] })
  }) as typeof fetch
  return { transport, calls: () => calls }
}

test("private image receipts replay without allocating/uploading/completing again", async () => {
  const { store, records, stages } = ledger(); const api = slack()
  for (let i = 0; i < 3; i++) assert.deepEqual(await uploadRecordedPrivateImage(identity, "secret", png(), store, api.transport), { ok: true, fileId: "F123" })
  assert.equal(api.calls(), 3)
  assert.deepEqual(stages, ["pending", "allocated", "uploading", "uploaded", "completing", "complete"])
  assert.ok(!JSON.stringify([...records]).includes("secret"))
  assert.ok(!JSON.stringify([...records]).includes("https://"))
  assert.deepEqual(await uploadRecordedPrivateImage(identity, "rotated-secret", png(), store, api.transport), { ok: false })
  const changed = png(); changed[32] = 1
  assert.deepEqual(await uploadRecordedPrivateImage(identity, "secret", changed, store, api.transport), { ok: false })
  assert.equal(api.calls(), 3)
})

test("ledger interruption at every stage cannot cause a second external allocation", async () => {
  for (const stage of ["allocated", "uploading", "uploaded", "completing", "complete"] as const) {
    const { store, records } = ledger(stage); const api = slack()
    assert.deepEqual(await uploadRecordedPrivateImage(identity, "secret", png(), store, api.transport), { ok: false })
    const calls = api.calls()
    assert.ok(calls > 0 && calls <= 3)
    assert.deepEqual(await uploadRecordedPrivateImage(identity, "secret", png(), store, api.transport), { ok: false })
    assert.equal(api.calls(), calls)
    if (stage === "complete") assert.equal([...records.values()][0]?.stage, "completing")
  }
})

test("ambiguous external completion preserves the known file ID and never retries", async () => {
  const { store, records } = ledger(); let calls = 0
  const transport = (async () => {
    calls++
    if (calls === 1) return Response.json({ ok: true, file_id: "F123", upload_url: "https://files.slack.com/upload/v1/test" })
    if (calls === 2) return new Response("OK")
    throw new Error("Lost completion acknowledgement")
  }) as typeof fetch
  for (let i = 0; i < 2; i++) assert.deepEqual(await uploadRecordedPrivateImage(identity, "secret", png(), store, transport), { ok: false })
  assert.equal(calls, 3)
  assert.equal([...records.values()][0]?.fileId, "F123")
  assert.equal([...records.values()][0]?.stage, "unresolved")
})

test("concurrent same-snapshot requests reserve once, and invalid input creates no intent", async () => {
  const { store, records } = ledger()
  let release!: () => void; let allocated!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const allocation = new Promise<void>((resolve) => { allocated = resolve })
  const api = slack()
  const transport = (async (...args) => {
    if (api.calls() === 0) { allocated(); await gate }
    return api.transport(...args)
  }) as typeof fetch
  const first = uploadRecordedPrivateImage(identity, "secret", png(), store, transport)
  await allocation
  assert.deepEqual(await uploadRecordedPrivateImage(identity, "secret", png(), store, transport), { ok: false })
  release()
  assert.deepEqual(await first, { ok: true, fileId: "F123" })
  assert.equal(api.calls(), 3)
  assert.equal(records.size, 1)
  assert.deepEqual(await uploadRecordedPrivateImage({ ...identity, snapshot: "invalid" }, "secret", png(), store, transport), { ok: false })
  assert.equal(records.size, 1)
})
