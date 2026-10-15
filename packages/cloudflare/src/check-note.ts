const sha = /^[0-9a-f]{40}$/
const ref = "refs/notes/effect-ci-hosted-checks-v1"

export interface GitHubCheckNoteReader {
  /** Pinned by host policy, not by the project or incoming note. */
  readonly repository: string
  /** Host-only authenticated fetch; receives fixed GitHub GET URLs, never blob URLs from replies. */
  readonly request: (url: string, init: RequestInit) => Promise<Response>
}

export interface GitHubCheckNote {
  readonly notesCommit: string
  readonly blobSha: string
  readonly text: string
}

const json = async <T>(response: Response, limit: number, signal: AbortSignal): Promise<T> => {
  if (!response.ok || response.redirected || !response.body) throw new Error("Evidence read unavailable")
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener("abort", cancel, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) throw new Error("Evidence read exceeds bound")
      chunks.push(chunk.value)
    }
  } finally {
    signal.removeEventListener("abort", cancel)
    await reader.cancel().catch(() => {})
  }
  if (signal.aborted) throw new Error("Evidence read timed out")
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T
}

/** Read an immutable note snapshot, not a trust verdict or a project credential capability. */
export const readGitHubCheckNote = async (
  options: GitHubCheckNoteReader,
  revision: string,
): Promise<GitHubCheckNote | undefined> => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repository) ||
      options.repository.split("/").some(part => part === "." || part === "..") || !sha.test(revision)) return undefined
  const controller = new AbortController()
  let deadline: ReturnType<typeof setTimeout>
  const timeout = new Promise<undefined>(resolve => {
    deadline = setTimeout(() => { controller.abort(); resolve(undefined) }, 10_000)
  })
  const base = `https://api.github.com/repos/${options.repository}/git`
  const read = async <T>(path: string, limit = 16_384): Promise<T> => {
    if (controller.signal.aborted) throw new Error("Evidence read timed out")
    const url = `${base}/${path}`
    // workerd rejects redirect:"error" before making any request. Manual mode
    // never follows redirects; the bounded reader rejects all non-2xx responses.
    const response = await options.request(url, { method: "GET", redirect: "manual", signal: controller.signal,
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2026-03-10" } })
    if (controller.signal.aborted) {
      await response.body?.cancel().catch(() => {})
      throw new Error("Evidence read timed out")
    }
    if (response.url && response.url !== url) throw new Error("Unexpected evidence endpoint")
    return json<T>(response, limit, controller.signal)
  }
  const lookup = async (): Promise<GitHubCheckNote | undefined> => {
    const reference = await read<{ ref: string; object: { type: string; sha: string } }>(`ref/${ref.slice(5)}`)
    if (reference.ref !== ref || reference.object?.type !== "commit" || !sha.test(reference.object.sha)) return undefined
    const notesCommit = reference.object.sha
    const commit = await read<{ sha: string; tree: { sha: string } }>(`commits/${notesCommit}`)
    if (commit.sha !== notesCommit || !sha.test(commit.tree?.sha)) return undefined
    const tree = await read<{ sha: string; truncated: boolean; tree: Array<{ path: string; type: string; mode: string; sha: string }> }>(
      `trees/${commit.tree.sha}?recursive=1`, 524_288)
    if (tree.sha !== commit.tree.sha || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 4096) return undefined
    const candidates = tree.tree.filter((item) => typeof item.path === "string" &&
      /^[0-9a-f]+(?:\/[0-9a-f]+)*$/.test(item.path) && item.path.replaceAll("/", "") === revision)
    if (candidates.length !== 1 || candidates[0].type !== "blob" || candidates[0].mode !== "100644" || !sha.test(candidates[0].sha)) return undefined
    const blobSha = candidates[0].sha
    const blob = await read<{ sha: string; encoding: string; size: number; content: string }>(`blobs/${blobSha}`, 65_536)
    if (blob.sha !== blobSha || blob.encoding !== "base64" || !Number.isInteger(blob.size) ||
        blob.size < 1 || blob.size > 24_576 || typeof blob.content !== "string") return undefined
    const encoded = blob.content.replace(/[\r\n]/g, "")
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return undefined
    const decoded = atob(encoded)
    if (decoded.length !== blob.size || btoa(decoded) !== encoded) return undefined
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
    const header = new TextEncoder().encode(`blob ${bytes.length}\0`)
    const object = new Uint8Array(header.length + bytes.length)
    object.set(header); object.set(bytes, header.length)
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", object)),
      byte => byte.toString(16).padStart(2, "0")).join("")
    if (digest !== blobSha) return undefined
    return { notesCommit, blobSha, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }
  }
  try { return await Promise.race([lookup(), timeout]) }
  catch {
    // Missing/auth/transport/schema/size/integrity failures are misses, not reflected errors.
    return undefined
  }
  finally { clearTimeout(deadline!) }
}
