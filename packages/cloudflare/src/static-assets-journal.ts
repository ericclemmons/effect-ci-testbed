import { DurableObject } from "cloudflare:workers"
import { prepareStaticAssets, staticAssetsTarget, staticAssetsPolicy } from "./static-assets-source.ts"
import { prepareBuiltStaticAssets, type StaticBuildProvenance } from "./static-assets-build.ts"

const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
const validRevision = (revision: string) => { if (typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision)) throw Error("Invalid static source revision"); return revision }
const sourceKey = (revision: string) => `source:${validRevision(revision)}`
interface Source { manifestDigest: string; bytes: Uint8Array; build?: { provenance: StaticBuildProvenance; bytes: Uint8Array } }
interface Publication { revision: string; assetDigest: string; steps: Record<string, string>; pending?: string; complete?: StaticAssetReceipt }
export interface StaticAssetReceipt { revision: string; manifestDigest: string; assetDigest: string; version: string; deployment: string; target: typeof staticAssetsTarget; policy: typeof staticAssetsPolicy; build?: StaticBuildProvenance }

/** Private source/journal only. No reset, overwrite, public fetch, credential or network API. */
export class StaticAssetRevisions extends DurableObject {
  async put(revision: string, manifestDigest: string, input: Uint8Array) {
    sourceKey(revision)
    if (!(input instanceof Uint8Array) || input.length > 96 * 1024) throw Error("Invalid static source bytes")
    const bytes = new Uint8Array(input)
    const prepared = await prepareStaticAssets(revision, bytes, manifestDigest)
    return this.#store(revision, manifestDigest, bytes, prepared.assetDigest)
  }
  async putBuild(revision: string, sourceManifestDigest: string, input: Uint8Array, result: unknown) {
    sourceKey(revision)
    if (!(input instanceof Uint8Array) || input.length > 96 * 1024) throw Error("Invalid static build bytes")
    const sourceBytes = new Uint8Array(input)
    const prepared = await prepareBuiltStaticAssets(revision, sourceBytes, sourceManifestDigest, result)
    const receipt = await this.#store(revision, prepared.manifestDigest, prepared.bytes, prepared.assetDigest,
      { provenance: prepared.build, bytes: sourceBytes })
    return { ...receipt, build: prepared.build }
  }
  async #store(revision: string, manifestDigest: string, bytes: Uint8Array, assetDigest: string, build?: Source["build"]) {
    const key = sourceKey(revision)
    return this.ctx.storage.transaction(async tx => {
      const existing = await tx.get<Source>(key)
      if (existing) {
        if (existing.manifestDigest !== manifestDigest || existing.bytes.length !== bytes.length || existing.bytes.some((byte, index) => byte !== bytes[index]) ||
            Boolean(existing.build) !== Boolean(build) || (build && (JSON.stringify(existing.build!.provenance) !== JSON.stringify(build.provenance) ||
              existing.build!.bytes.length !== build.bytes.length || existing.build!.bytes.some((byte, index) => byte !== build.bytes[index]))))
          throw Error("Immutable static source conflict")
        return { revision, manifestDigest, assetDigest, created: false }
      }
      if ((await tx.list({ prefix: "source:", limit: 32 })).size >= 32) throw Error("Static source revision limit exceeded")
      await tx.put(key, { manifestDigest, bytes, ...(build ? { build } : {}) } satisfies Source)
      return { revision, manifestDigest, assetDigest, created: true }
    })
  }
  async get(revision: string) {
    const source = await this.ctx.storage.get<Source>(sourceKey(revision))
    if (!source) throw Error("Static source not found")
    const prepared = await prepareStaticAssets(revision, source.bytes, source.manifestDigest)
    if (source.build) {
      const provenance = source.build.provenance
      const code = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(prepared.assets.find(a => a.path === "app.js")!.base64), c => c.charCodeAt(0)))
      const checked = await prepareBuiltStaticAssets(revision, source.build.bytes, provenance.sourceManifestDigest,
        { runtime: "dynamic-worker", containers: 0, tool: provenance.tool, code,
          sourceDigest: provenance.sourceDigest, outputDigest: provenance.outputDigest, toolDigest: provenance.toolDigest })
      if (checked.manifestDigest !== source.manifestDigest || JSON.stringify(checked.build) !== JSON.stringify(provenance))
        throw Error("Static build provenance mismatch")
    }
    return { revision, manifestDigest: source.manifestDigest, assetDigest: prepared.assetDigest, bytes: new Uint8Array(source.bytes),
      ...(source.build ? { build: { ...source.build.provenance } } : {}) }
  }
  async begin(revision: string) {
    const source = await this.get(revision)
    return this.ctx.storage.transaction(async tx => {
      const active = await tx.get<string>("active")
      if (active && active !== revision) throw Error("Static publication already active")
      const key = `publication:${revision}`, existing = await tx.get<Publication>(key)
      if (existing) {
        if (existing.assetDigest !== source.assetDigest) throw Error("Static publication identity mismatch")
        if (existing.complete) return existing.complete
        throw Error("Static publication unresolved; read-only reconciliation required")
      }
      await tx.put(key, { revision, assetDigest: source.assetDigest, steps: {} } satisfies Publication)
      await tx.put("active", revision)
      return null
    })
  }
  async intent(revision: string, step: string) {
    validRevision(revision)
    if (!/^(?:session|assets:[0-2]|version|deployment)$/.test(step)) throw Error("Unknown static mutation")
    await this.ctx.storage.transaction(async tx => {
      const record = await tx.get<Publication>(`publication:${revision}`)
      if (!record || record.complete || await tx.get("active") !== revision || record.pending || Object.hasOwn(record.steps, step)) throw Error("Static mutation already claimed or publication unavailable")
      if (step === "session" && Object.keys(record.steps).length !== 0 ||
        step !== "session" && !record.steps.session ||
        step.startsWith("assets:") && (record.steps.version || Number(step.slice(7)) > 0 && !record.steps[`assets:${Number(step.slice(7)) - 1}`]) ||
        step === "deployment" && !record.steps.version) throw Error("Static mutation order mismatch")
      // Persist BEFORE any external request. An acknowledgement loss cannot release this claim.
      await tx.put(`publication:${revision}`, { ...record, pending: step })
    })
  }
  async acknowledge(revision: string, step: string, identity: string) {
    validRevision(revision)
    if (typeof identity !== "string" || (step === "version" || step === "deployment" ? !uuid(identity) : !/^[a-f0-9]{64}$/.test(identity))) throw Error("Invalid static mutation receipt")
    await this.ctx.storage.transaction(async tx => {
      const record = await tx.get<Publication>(`publication:${revision}`)
      if (!record || record.complete || await tx.get("active") !== revision || record.pending !== step) throw Error("Static mutation receipt has no matching intent")
      const { pending: _, ...rest } = record
      await tx.put(`publication:${revision}`, { ...rest, steps: { ...record.steps, [step]: identity } })
    })
  }
  async inspect(revision: string) {
    validRevision(revision)
    const record = await this.ctx.storage.get<Publication>(`publication:${revision}`)
    if (!record) return null
    return { revision: record.revision, assetDigest: record.assetDigest, pending: record.pending ?? null,
      steps: { ...record.steps }, complete: record.complete ? { ...record.complete } : null }
  }
  /** Host calls only AFTER independent served bytes and deployment readback match. */
  async complete(revision: string, version: string, deployment: string) {
    if (!uuid(version) || !uuid(deployment)) throw Error("Invalid static completion identity")
    const source = await this.get(revision)
    return this.ctx.storage.transaction(async tx => {
      const record = await tx.get<Publication>(`publication:${revision}`)
      if (!record || record.pending || !record.steps.session || record.steps.version !== version || record.steps.deployment !== deployment) throw Error("Static completion has no matching acknowledged mutations")
      if (record.complete) return record.complete
      if (await tx.get("active") !== revision) throw Error("Static publication ownership mismatch")
      const receipt: StaticAssetReceipt = { revision, manifestDigest: source.manifestDigest, assetDigest: source.assetDigest, version, deployment, target: staticAssetsTarget, policy: staticAssetsPolicy,
        ...(source.build ? { build: source.build } : {}) }
      await tx.put(`publication:${revision}`, { ...record, complete: receipt })
      await tx.delete("active")
      return receipt
    })
  }
}
