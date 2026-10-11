import type { SlackBlock } from "./run-card.ts"

export type PrivateSlackImageResult =
  | { readonly ok: true; readonly fileId: string }
  | { readonly ok: false }

const fileIdPattern = /^F[A-Z0-9]+$/

/** Accept only bounded PNG output from our trusted chart renderer, not arbitrary SVG or URLs. */
export const boundedTrustedPng = (bytes: Uint8Array): boolean => {
  if (bytes.length < 33 || bytes.length > 1_000_000) return false
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!signature.every((value, index) => bytes[index] === value)) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) return false
  const width = view.getUint32(16)
  const height = view.getUint32(20)

  return width > 0 && height > 0 && width <= 2048 && height <= 2048 && width * height <= 2_000_000
}

/**
 * Worker-side only. Completion deliberately omits channel_id/thread_ts, so it
 * creates no file-share message. The same bot may reference the receipt in an
 * existing card. Caller must checkpoint successful receipts; this does not retry
 * ambiguous uploads, expose public URLs, or log credential-bearing errors.
 */
export const uploadPrivateSlackImage = async (
  botToken: string,
  png: Uint8Array,
  transport: typeof fetch = fetch,
  progress?: (stage: "allocated" | "uploading" | "uploaded" | "completing", fileId: string) => Promise<void>,
): Promise<PrivateSlackImageResult> => {
  if (!botToken || !boundedTrustedPng(png)) return { ok: false }
  // Own the buffer before the first await; caller mutation cannot change the upload.
  const bytes = new Uint8Array(png)
  const api = async (method: string, body: unknown): Promise<Record<string, unknown>> => {
    const form = method === "files.getUploadURLExternal"
    const response = await transport(`https://slack.com/api/${method}`, {
      method: "POST",
      // workerd rejects RequestInit.redirect="error". Manual mode never follows
      // redirects; every non-2xx response below fails closed without forwarding auth.
      redirect: "manual",
      headers: { authorization: `Bearer ${botToken}`, "content-type": form ? "application/x-www-form-urlencoded" : "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: form ? new URLSearchParams(Object.entries(body as Record<string, unknown>).map(([key, value]) => [key, String(value)])).toString() : JSON.stringify(body),
    })
    if (!response.ok) throw new Error("Image API failed")
    const result = await response.json() as Record<string, unknown>
    if (result.ok !== true) throw new Error("Image API failed")

    return result
  }
  try {
    const allocation = await api("files.getUploadURLExternal", {
      filename: "confidence.png", length: bytes.length,
    })
    if (typeof allocation.file_id !== "string" || !fileIdPattern.test(allocation.file_id) ||
      typeof allocation.upload_url !== "string") return { ok: false }
    const url = new URL(allocation.upload_url)
    if (url.protocol !== "https:" || url.hostname !== "files.slack.com" || url.port ||
      url.username || url.password || !url.pathname.startsWith("/upload/v1/")) return { ok: false }
    await progress?.("allocated", allocation.file_id)
    await progress?.("uploading", allocation.file_id)
    const uploaded = await transport(url, {
      method: "POST", redirect: "manual", headers: { "content-type": "image/png" },
      body: bytes, signal: AbortSignal.timeout(10_000),
    })
    await uploaded.body?.cancel()
    if (!uploaded.ok) return { ok: false }
    await progress?.("uploaded", allocation.file_id)
    await progress?.("completing", allocation.file_id)
    const completed = await api("files.completeUploadExternal", {
      files: [{ id: allocation.file_id, title: "Confidence intervals" }],
    })
    if (!Array.isArray(completed.files) || completed.files.length !== 1 ||
      completed.files[0]?.id !== allocation.file_id || completed.files[0]?.is_public === true) return { ok: false }

    return { ok: true, fileId: allocation.file_id }
  } catch {
    return { ok: false }
  }
}

export const privateSlackImageBlock = (fileId: string): SlackBlock => {
  if (!fileIdPattern.test(fileId)) throw new Error("Invalid Slack image receipt")

  return { type: "image", slack_file: { id: fileId }, alt_text: "Observed health confidence intervals; not a forecast" }
}
