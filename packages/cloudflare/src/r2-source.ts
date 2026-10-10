import type { SourceFile } from "./artifacts-source.ts"

interface SourceBucket {
  get(key: string): Promise<{ readonly size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>
}

/** Read a bounded content-addressed manifest; never trust a mutable key or ETag as source identity. */
export async function readR2Source(bucket: SourceBucket, key: string, digest: string): Promise<SourceFile[]> {
  if (!key || key.length > 1024 || /[\x00-\x1f]/.test(key) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid R2 source reference")
  const object = await bucket.get(key)
  if (!object) throw new Error("R2 source not found")
  if (!Number.isSafeInteger(object.size) || object.size < 0 || object.size > 96 * 1024) throw new Error("R2 manifest limit exceeded")
  const data = new Uint8Array(await object.arrayBuffer())
  if (data.byteLength !== object.size || data.byteLength > 96 * 1024) throw new Error("R2 source size mismatch")
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data))
  const actual = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")
  if (actual !== digest) throw new Error("R2 source digest mismatch")
  const manifest: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data))
  if (!manifest || typeof manifest !== "object" || !("version" in manifest) || manifest.version !== 1 ||
    !("files" in manifest) || !Array.isArray(manifest.files) || manifest.files.length > 1000) throw new Error("Invalid R2 source manifest")
  const files: SourceFile[] = []
  const paths = new Set<string>()
  const directories = new Set<string>()
  let bytes = 0
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string" || typeof entry.base64 !== "string" || typeof entry.executable !== "boolean") throw new Error("Invalid R2 source file")
    const segments = entry.path.split("/")
    if (segments.length > 32 || segments.some((name: string) => !name || name === "." || name === ".." ||
      /[\\\x00-\x1f]/.test(name) || new TextEncoder().encode(name).length > 255) || paths.has(entry.path) || directories.has(entry.path)) throw new Error("Invalid R2 source path")
    for (let depth = 1; depth < segments.length; depth++) {
      const directory = segments.slice(0, depth).join("/")
      if (paths.has(directory)) throw new Error("R2 source file conflicts with directory")
      directories.add(directory)
    }
    // Canonical base64 excludes whitespace, malformed padding and ambiguous encodings.
    let binary: string
    try { binary = atob(entry.base64) } catch { throw new Error("Invalid R2 source encoding") }
    if (btoa(binary) !== entry.base64) throw new Error("Invalid R2 source encoding")
    bytes += binary.length
    if (bytes > 64 * 1024) throw new Error("R2 source byte limit exceeded")
    paths.add(entry.path)
    files.push({ path: entry.path, base64: entry.base64, executable: entry.executable })
  }
  return files
}
