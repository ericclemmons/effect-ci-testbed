import type { ImageReceiptStore } from "./private-image-receipts.ts"

const digest = async (value: Uint8Array) => Array.from(new Uint8Array(
  await crypto.subtle.digest("SHA-256", new Uint8Array(value))), byte => byte.toString(16).padStart(2, "0")).join("")
const encode = (value: string) => new TextEncoder().encode(value)

/** Host-only captured output, already redacted. Shares only to the configured
 * channel and known parent thread; never creates a public file URL. The existing
 * file journal records intent before allocation and stops uncertain replays.
 */
export async function uploadRecordedSlackLog(
  identity: { runId: string; stepId: string; destination: string; channel: string; threadTs: string },
  token: string,
  text: string,
  store: ImageReceiptStore,
  transport: typeof fetch = fetch,
): Promise<{ ok: true; fileId: string } | { ok: false }> {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(identity.runId) || !identity.stepId || identity.stepId.length > 4096 ||
      !/^[A-Z0-9:_-]{1,128}$/.test(identity.destination) || !/^[CG][A-Z0-9]+$/.test(identity.channel) ||
      !/^\d+\.\d+$/.test(identity.threadTs) || !token || !text) return { ok: false }
  const bytes = encode(text)
  if (bytes.length > 72_000) return { ok: false }
  const key = `log:${identity.runId}:${await digest(encode(identity.stepId))}:${identity.destination}`
  const fingerprint = await digest(encode(JSON.stringify([
    await digest(bytes), await digest(encode(token)), identity.channel, identity.threadTs,
  ])))
  let fileId: string | undefined
  const api = async (method: "files.getUploadURLExternal" | "files.completeUploadExternal", body: Record<string, unknown>) => {
    const form = method === "files.getUploadURLExternal"
    const response = await transport(`https://slack.com/api/${method}`, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "content-type": form ? "application/x-www-form-urlencoded" : "application/json" },
      body: form ? new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)])).toString() : JSON.stringify(body),
    })
    if (!response.ok || !response.body) throw Error("Log upload unavailable")
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.length
        if (size > 65536) { await reader.cancel(); throw Error("Log receipt too large") }
        chunks.push(part.value)
      }
    } finally { reader.releaseLock() }
    const data = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length }
    const result = JSON.parse(new TextDecoder().decode(data))
    if (result.ok !== true) throw Error("Log upload unavailable")
    return result
  }
  try {
    const reservation = await store.reserve(key, fingerprint)
    if (!reservation.acquired) {
      const receipt = reservation.receipt
      return receipt.fingerprint === fingerprint && receipt.stage === "complete" && /^F[A-Z0-9]+$/.test(receipt.fileId ?? "")
        ? { ok: true, fileId: receipt.fileId! } : { ok: false }
    }
    const title = identity.stepId.replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 100)
    const allocation = await api("files.getUploadURLExternal", {
      filename: "ci-output.txt", length: bytes.length, snippet_type: "text",
    })
    if (typeof allocation.file_id !== "string" || !/^F[A-Z0-9]+$/.test(allocation.file_id) ||
        typeof allocation.upload_url !== "string") throw Error("Invalid log allocation")
    fileId = allocation.file_id
    const url = new URL(allocation.upload_url)
    if (url.protocol !== "https:" || url.hostname !== "files.slack.com" || url.port || url.username || url.password ||
        !url.pathname.startsWith("/upload/v1/")) throw Error("Invalid log destination")
    await store.advance(key, fingerprint, "allocated", fileId)
    await store.advance(key, fingerprint, "uploading", fileId)
    const uploaded = await transport(url, { method: "POST", redirect: "manual", body: bytes,
      headers: { "content-type": "text/plain; charset=utf-8" }, signal: AbortSignal.timeout(10_000) })
    await uploaded.body?.cancel()
    if (!uploaded.ok) throw Error("Log upload unavailable")
    await store.advance(key, fingerprint, "uploaded", fileId)
    await store.advance(key, fingerprint, "completing", fileId)
    const completed = await api("files.completeUploadExternal", {
      files: [{ id: fileId, title: `${title} · captured output` }],
      channel_id: identity.channel, thread_ts: identity.threadTs,
    })
    if (!Array.isArray(completed.files) || completed.files.length !== 1 || completed.files[0]?.id !== fileId ||
        completed.files[0]?.public_url_shared === true) throw Error("Invalid log completion")
    await store.advance(key, fingerprint, "complete", fileId)
    return { ok: true, fileId: fileId! }
  } catch {
    // If reserve/advance itself failed, keep its persisted intent. Never erase it
    // or allocate another file merely because the acknowledgement is missing.
    try { await store.advance(key, fingerprint, "unresolved", fileId) } catch { /* retained intent is authoritative */ }
    return { ok: false }
  }
}
