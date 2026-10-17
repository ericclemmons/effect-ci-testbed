import type * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { runnerReceiptDigest } from "./runner-check-receipt.ts"

export interface RunnerStepIdentity {
  readonly kind: "step-result"
  readonly repository: string
  readonly revision: string
  readonly workflowId: string
  readonly stepId: string
  readonly policyDigest: string
  readonly runtimeDigest: string
}
/** A provider-owned immutable artifact handle, not the producing run's Workspace. */
export interface RunnerWorkspaceResult {
  readonly kind: "workspace"
  readonly provider: "cloudflare-container"
  readonly cwd: string
  readonly snapshot: { readonly id: string; readonly size: number; readonly name?: string }
}
export interface RunnerStepClaim {
  readonly identity: RunnerStepIdentity
  readonly runId: string
  readonly completedAt: string
  readonly conclusion: "success"
  readonly result: RunnerWorkspaceResult
}
export interface RunnerStepReceipt {
  readonly version: 1
  readonly keyId: string
  readonly claim: RunnerStepClaim
  readonly signature: string
}
const encoder = new TextEncoder()
const bounded = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value)
const keysAre = (value: object, names: string) => Object.keys(value).sort().join() === names
const identityTuple = (identity: RunnerStepIdentity) => {
  if (!identity || !keysAre(identity, "kind,policyDigest,repository,revision,runtimeDigest,stepId,workflowId") ||
      identity.kind !== "step-result" || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(identity.repository) ||
      !/^[a-f0-9]{40}$/.test(identity.revision) || !bounded(identity.workflowId, 256) || !bounded(identity.stepId, 256) ||
      !/^[a-f0-9]{64}$/.test(identity.policyDigest) || !/^[a-f0-9]{64}$/.test(identity.runtimeDigest)) throw Error("Invalid step result identity")
  return [identity.kind, identity.repository, identity.revision, identity.workflowId, identity.stepId, identity.policyDigest, identity.runtimeDigest]
}
const resultTuple = (result: RunnerWorkspaceResult) => {
  if (!result || !keysAre(result, "cwd,kind,provider,snapshot") || result.kind !== "workspace" || result.provider !== "cloudflare-container" ||
      !bounded(result.cwd, 1024) || !/^\/workspace\/repository(?:\/[^/]+)*$/.test(result.cwd) ||
      result.cwd.split("/").some(segment => segment === "." || segment === "..") ||
      !result.snapshot || !["id,name,size", "id,size"].includes(Object.keys(result.snapshot).sort().join()) ||
      !bounded(result.snapshot.id, 1024) || !Number.isSafeInteger(result.snapshot.size) || result.snapshot.size < 0 ||
      (result.snapshot.name !== undefined && !bounded(result.snapshot.name, 256))) throw Error("Invalid workspace result")
  return [result.kind, result.provider, result.cwd, result.snapshot.id, result.snapshot.size, result.snapshot.name ?? null]
}
export const runnerStepFingerprint = (identity: RunnerStepIdentity) =>
  runnerReceiptDigest(encoder.encode(JSON.stringify(["effect-ci-step-inputs", 1, identityTuple(identity)])))
const bytes = (keyId: string, claim: RunnerStepClaim): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId) || !claim ||
      !keysAre(claim, "completedAt,conclusion,identity,result,runId") || claim.conclusion !== "success" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(claim.runId) ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(claim.completedAt) ||
      !Number.isFinite(Date.parse(claim.completedAt))) throw Error("Invalid step result claim")
  return encoder.encode(JSON.stringify(["effect-ci-step-result", 1, keyId, identityTuple(claim.identity),
    claim.runId, claim.completedAt, claim.conclusion, resultTuple(claim.result)]))
}
const base64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
export async function signRunnerStepReceipt(keyId: string, key: CryptoKey, claim: RunnerStepClaim): Promise<RunnerStepReceipt> {
  if (key.type !== "private" || key.algorithm.name !== "Ed25519" || !key.usages.includes("sign")) throw Error("Invalid runner signing key")
  const copy = JSON.parse(JSON.stringify(claim)) as RunnerStepClaim
  const signature = await crypto.subtle.sign("Ed25519", key, bytes(keyId, copy))
  return { version: 1, keyId, claim: copy, signature: base64url(new Uint8Array(signature)) }
}
export async function verifyRunnerStepReceipt(serialized: string | undefined, expected: RunnerStepIdentity,
  keys: ReadonlyMap<string, CryptoKey>): Promise<RunnerWorkspaceResult | undefined> {
  try {
    if (!serialized || serialized.length > 24_576) return
    const receipt = JSON.parse(serialized) as RunnerStepReceipt
    if (!receipt || !keysAre(receipt, "claim,keyId,signature,version") || receipt.version !== 1 ||
        !/^[A-Za-z0-9_-]{86}$/.test(receipt.signature)) return
    const key = keys.get(receipt.keyId)
    if (!key || key.type !== "public" || key.algorithm.name !== "Ed25519" || !key.usages.includes("verify")) return
    if (JSON.stringify(identityTuple(expected)) !== JSON.stringify(identityTuple(receipt.claim.identity))) return
    const signature = Uint8Array.from(atob(receipt.signature.replace(/-/g, "+").replace(/_/g, "/") + "=="), c => c.charCodeAt(0))
    if (base64url(signature) !== receipt.signature || !await crypto.subtle.verify("Ed25519", key, signature, bytes(receipt.keyId, receipt.claim))) return
    return receipt.claim.result
  } catch { return }
}

export interface RunnerStepAuthority {
  /** Verify against this authority's enrolled key and exact expected identity. */
  readonly stepResult: (identity: RunnerStepIdentity) => Promise<RunnerWorkspaceResult | undefined>
  readonly recordStepResult: (claim: RunnerStepClaim) => Promise<void>
}

export function runnerWorkspaceResultCache(options: {
  readonly runId: string
  readonly identify: (request: CI.StepResultCacheRequest) => Promise<RunnerStepIdentity | undefined>
  readonly authority: RunnerStepAuthority
  readonly capture: (value: unknown, request: CI.StepResultCacheRequest) => Promise<RunnerWorkspaceResult | undefined>
  /** Restore and validate availability, hydrating ownership into the receiving
   * run. A missing/deleted snapshot must throw or return undefined: execute normally. */
  readonly restore: (result: RunnerWorkspaceResult, request: CI.StepResultCacheRequest) => Promise<unknown | undefined>
}): CI.StepResultCache {
  const pending = new WeakMap<CI.StepResultCacheRequest, RunnerStepIdentity>()
  return {
    lookup: request => Effect.tryPromise({ try: async () => {
      pending.delete(request)
      const computed = await options.identify(request), source = request.event.source
      if (!computed || source?.kind !== "git" || source.repository.replace(/\.git$/, "") !== computed.repository ||
          source.revision !== computed.revision || request.event.revision !== computed.revision ||
          request.workflowId !== computed.workflowId || request.stepId !== computed.stepId) return
      const identity = Object.freeze({ ...computed })
      await runnerStepFingerprint(identity)
      pending.set(request, identity)
      const result = await options.authority.stepResult(identity)
      if (!result) return
      const value = await options.restore(result, request)
      return value === undefined ? undefined : { value }
    }, catch: error => error }),
    record: (request, value) => Effect.tryPromise({ try: async () => {
      const identity = pending.get(request)
      pending.delete(request)
      if (!identity) return
      const result = await options.capture(value, request)
      if (!result) return
      resultTuple(result)
      await options.authority.recordStepResult({ identity, result, runId: options.runId,
        completedAt: new Date().toISOString(), conclusion: "success" })
    }, catch: error => error }),
  }
}
