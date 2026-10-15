import { prepareStaticAssets } from "./static-assets-source.ts"

const base = "https://api.github.com/repos/ericclemmons/effect-ci-testbed/git/"
const prefix = "examples/static-assets-source/"
const paths = ["site/app.js", "site/index.html", "site/style.css"]
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("")

/** Closed immutable Git API reads through a host-owned, already-scoped GET capability. */
export async function readStaticAssetsGitHub(revision: string, request: typeof fetch) {
  if (typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision)) throw Error("Invalid static source revision")
  const read = async (path: string, limit: number): Promise<any> => {
    const response = await request(base + path, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10_000) })
    if (response.status !== 200 || response.redirected || !response.body) { await response.body?.cancel(); throw Error("Static source read unavailable") }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length
      if (size > limit) throw Error("Static source response limit exceeded")
      chunks.push(part.value)
    } } finally { await reader.cancel().catch(() => {}) }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  }
  const commit = await read(`commits/${revision}`, 128 * 1024)
  if (commit.sha !== revision || !/^[a-f0-9]{40}$/.test(commit.tree?.sha)) throw Error("Static commit identity mismatch")
  const tree = await read(`trees/${commit.tree.sha}?recursive=1`, 2 * 1024 * 1024)
  if (tree.sha !== commit.tree.sha || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 10_000) throw Error("Static tree identity mismatch")
  const files = []
  for (const path of paths) {
    const entries = tree.tree.filter((entry: any) => entry?.path === prefix + path)
    const entry = entries[0]
    if (entries.length !== 1 || entry.type !== "blob" || entry.mode !== "100644" || !/^[a-f0-9]{40}$/.test(entry.sha) ||
      !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 32 * 1024) throw Error("Static source file identity mismatch")
    const blob = await read(`blobs/${entry.sha}`, 64 * 1024)
    if (blob.sha !== entry.sha || blob.size !== entry.size || blob.encoding !== "base64" || typeof blob.content !== "string") throw Error("Static blob identity mismatch")
    const base64 = blob.content.replace(/\n/g, "")
    const binary = atob(base64)
    if (btoa(binary) !== base64 || binary.length !== entry.size) throw Error("Static blob encoding mismatch")
    const data = Uint8Array.from(binary, character => character.charCodeAt(0))
    const header = new TextEncoder().encode(`blob ${data.length}\0`), gitBytes = new Uint8Array(header.length + data.length)
    gitBytes.set(header); gitBytes.set(data, header.length)
    if (hex(await crypto.subtle.digest("SHA-1", gitBytes)) !== entry.sha) throw Error("Static blob byte identity mismatch")
    files.push({ path, base64, executable: false })
  }
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, files }))
  const manifestDigest = hex(await crypto.subtle.digest("SHA-256", bytes))
  await prepareStaticAssets(revision, bytes, manifestDigest)
  return { revision, manifestDigest, bytes }
}
