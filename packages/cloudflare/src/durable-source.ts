import { DurableObject } from "cloudflare:workers"
import { decodeSourceManifest } from "./source-manifest.ts"

const key = (revision: string) => {
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("Durable source requires an immutable SHA-256 revision")
  return `revision:${revision}`
}

/** Host-only RPC storage. No fetch handler, mutable aliases, overwrite, or delete. */
export class SourceRevisions extends DurableObject {
  async put(revision: string, input: Uint8Array): Promise<{ revision: string; created: boolean }> {
    const name = key(revision)
    if (!(input instanceof Uint8Array) || input.byteLength > 96 * 1024) throw new Error("Durable source byte limit exceeded")
    const data = new Uint8Array(input)
    await decodeSourceManifest(data, revision)
    return this.ctx.storage.transaction(async transaction => {
      const existing = await transaction.get<Uint8Array>(name)
      if (existing) {
        if (existing.length !== data.length || existing.some((byte, index) => byte !== data[index])) throw new Error("Immutable source conflict")
        return { revision, created: false }
      }
      if ((await transaction.list({ prefix: "revision:", limit: 32 })).size >= 32) throw new Error("Durable source revision limit exceeded")
      await transaction.put(name, data)
      return { revision, created: true }
    })
  }

  async get(revision: string): Promise<Uint8Array> {
    const data = await this.ctx.storage.get<Uint8Array>(key(revision))
    if (!data) throw new Error("Durable source revision not found")
    await decodeSourceManifest(data, revision)
    return data
  }
}

/** Readers receive only bounded source files, never the storage binding or writer. */
export const readDurableSource = async (stub: Pick<SourceRevisions, "get">, revision: string) =>
  decodeSourceManifest(await stub.get(revision), revision)
