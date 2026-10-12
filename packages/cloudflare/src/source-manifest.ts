import type { SourceFile } from "./artifacts-source.ts"

/** Exact-byte content identity shared by binding-backed manifest providers. */
export async function decodeSourceManifest(input: Uint8Array, digest: string): Promise<SourceFile[]> {
  if (!(input instanceof Uint8Array) || input.byteLength > 96 * 1024 || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid source manifest reference")
  // Own the bytes across the asynchronous digest; caller mutation cannot change parsing.
  const data = new Uint8Array(input)
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data))
  const actual = Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("")
  if (actual !== digest) throw new Error("Source digest mismatch")
  const manifest: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data))
  if (!manifest || typeof manifest !== "object" || !("version" in manifest) || manifest.version !== 1 ||
    !("files" in manifest) || !Array.isArray(manifest.files) || manifest.files.length > 1000) throw new Error("Invalid source manifest")
  const files: SourceFile[] = []
  const paths = new Set<string>(), directories = new Set<string>()
  let bytes = 0
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string" || typeof entry.base64 !== "string" || typeof entry.executable !== "boolean") throw new Error("Invalid source file")
    const segments = entry.path.split("/")
    if (segments.length > 32 || segments.some((name: string) => !name || name === "." || name === ".." ||
      /[\\\x00-\x1f]/.test(name) || new TextEncoder().encode(name).length > 255) || paths.has(entry.path) || directories.has(entry.path)) throw new Error("Invalid source path")
    for (let depth = 1; depth < segments.length; depth++) {
      const directory = segments.slice(0, depth).join("/")
      if (paths.has(directory)) throw new Error("Source file conflicts with directory")
      directories.add(directory)
    }
    let binary: string
    try { binary = atob(entry.base64) } catch { throw new Error("Invalid source encoding") }
    if (btoa(binary) !== entry.base64) throw new Error("Invalid source encoding")
    bytes += binary.length
    if (bytes > 64 * 1024) throw new Error("Source byte limit exceeded")
    paths.add(entry.path)
    files.push({ path: entry.path, base64: entry.base64, executable: entry.executable })
  }
  return files
}
