import assert from "node:assert/strict"
import test from "node:test"
import { privateSlackImageBlock, uploadPrivateSlackImage } from "./slack-images.ts"

// Header-only fixture exercises transport bounds, not a PNG decoder/rendering proof.
const png = (): Uint8Array => {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  view.setUint32(12, 0x49484452)
  view.setUint32(16, 640)
  view.setUint32(20, 320)

  return bytes
}

test("private upload omits channel sharing and never sends bot credentials to upload URL", async () => {
  const requests: Array<{ url: string; options: RequestInit }> = []
  const transport = (async (url, options) => {
    requests.push({ url: String(url), options: options! })
    if (requests.length === 1) return Response.json({ ok: true, file_id: "F123", upload_url: "https://files.slack.com/upload/v1/test" })
    if (requests.length === 2) return new Response("OK")

    return Response.json({ ok: true, files: [{ id: "F123", is_public: false }] })
  }) as typeof fetch
  assert.deepEqual(await uploadPrivateSlackImage("secret", png(), transport), { ok: true, fileId: "F123" })
  assert.equal(requests.length, 3)
  assert.equal(new Headers(requests[0]!.options.headers).get("authorization"), "Bearer secret")
  assert.equal(new Headers(requests[0]!.options.headers).get("content-type"), "application/x-www-form-urlencoded")
  assert.equal(new URLSearchParams(String(requests[0]!.options.body)).get("length"), "33")
  assert.equal(new URLSearchParams(String(requests[0]!.options.body)).get("filename"), "confidence.png")
  assert.equal(new Headers(requests[1]!.options.headers).has("authorization"), false)
  for (const request of requests) assert.equal(request.options.redirect, "manual")
  assert.deepEqual(JSON.parse(String(requests[2]!.options.body)), { files: [{ id: "F123", title: "Confidence intervals" }] })
  assert.deepEqual(privateSlackImageBlock("F123"), { type: "image", slack_file: { id: "F123" }, alt_text: "Observed health confidence intervals; not a forecast" })
})

test("invalid, oversized or excessive-dimension images never leave the Worker", async () => {
  const transport = (async () => { throw new Error("must not send") }) as typeof fetch
  const huge = png()
  new DataView(huge.buffer).setUint32(16, 9999)
  for (const bytes of [new Uint8Array(), new Uint8Array(1_000_001), huge]) {
    assert.deepEqual(await uploadPrivateSlackImage("secret", bytes, transport), { ok: false })
  }
  assert.throws(() => privateSlackImageBlock("https://public.example/image"))
})

test("unexpected upload origins fail closed without uploading bytes", async () => {
  for (const upload_url of ["https://files.slack.com.evil.test/upload/v1/x", "http://files.slack.com/upload/v1/x", "https://files.slack.com:444/upload/v1/x", "https://user:password@files.slack.com/upload/v1/x", "https://files.slack.com/other"]) {
    let calls = 0
    const transport = (async () => { calls++; return Response.json({ ok: true, file_id: "F123", upload_url }) }) as typeof fetch
    assert.deepEqual(await uploadPrivateSlackImage("secret", png(), transport), { ok: false })
    assert.equal(calls, 1)
  }
})

test("failure at any stage is redacted, not retried and never reported as success", async () => {
  for (const stage of [1, 2, 3]) {
    let calls = 0
    const transport = (async () => {
      calls++
      if (calls === stage) throw new Error("secret upload URL and token")
      if (calls === 1) return Response.json({ ok: true, file_id: "F123", upload_url: "https://files.slack.com/upload/v1/x" })
      return new Response("OK")
    }) as typeof fetch
    assert.deepEqual(await uploadPrivateSlackImage("secret", png(), transport), { ok: false })
    assert.equal(calls, stage)
  }
})

test("completion must acknowledge the exact private file", async () => {
  for (const files of [[], [{ id: "FOTHER" }], [{ id: "F123", is_public: true }]]) {
    let calls = 0
    const transport = (async () => {
      calls++
      if (calls === 1) return Response.json({ ok: true, file_id: "F123", upload_url: "https://files.slack.com/upload/v1/x" })
      if (calls === 2) return new Response("OK")

      return Response.json({ ok: true, files })
    }) as typeof fetch
    assert.deepEqual(await uploadPrivateSlackImage("secret", png(), transport), { ok: false })
  }
})
