import type { SourceFile } from "./artifacts-source.ts"
import { decodeSourceManifest } from "./source-manifest.ts"

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
  return decodeSourceManifest(data, digest)
}
