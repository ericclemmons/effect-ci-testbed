import type { CheckCache, CheckCacheRequest, CommandExecutionResult } from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { hostedCheckBytes, type HostedCheckIdentity } from "./check-evidence.ts"

/** A host's statement about an execution, not a Git commit signature or merge permission. */
export interface RunnerCheckClaim {
  readonly identity: HostedCheckIdentity
  readonly runId: string
  readonly completedAt: string
  readonly exitCode: 0
  readonly stdoutDigest: string
  readonly stderrDigest: string
}
export interface RunnerCheckReceipt {
  readonly version: 1
  readonly keyId: string
  readonly claim: RunnerCheckClaim
  readonly signature: string
}
const encoder = new TextEncoder()
const hex = /^[a-f0-9]{64}$/
const keyIdPattern = /^[A-Za-z0-9_-]{1,64}$/
const base64url = (value: Uint8Array) => btoa(String.fromCharCode(...value))
  .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
export const runnerReceiptDigest = async (value: Uint8Array<ArrayBuffer>): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)), b => b.toString(16).padStart(2, "0")).join("")
export const runnerCheckFingerprint = (identity: HostedCheckIdentity) => runnerReceiptDigest(hostedCheckBytes(identity))

const claimBytes = (keyId: string, claim: RunnerCheckClaim): Uint8Array<ArrayBuffer> => {
  if (!keyIdPattern.test(keyId) || !claim || claim.exitCode !== 0 ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(claim.runId) ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(claim.completedAt) ||
      !Number.isFinite(Date.parse(claim.completedAt)) ||
      !hex.test(claim.stdoutDigest) || !hex.test(claim.stderrDigest)) throw Error("Invalid runner check claim")
  return encoder.encode(JSON.stringify(["effect-ci-runner-check", 1, keyId,
    new TextDecoder().decode(hostedCheckBytes(claim.identity)), claim.runId, claim.completedAt,
    claim.exitCode, claim.stdoutDigest, claim.stderrDigest]))
}

/** Only a host continuation may call this, after the runner returned exit code 0.
 * The key must never be mounted in a workspace or passed to project code. */
export async function signRunnerCheckReceipt(
  keyId: string, key: CryptoKey, claim: RunnerCheckClaim,
): Promise<RunnerCheckReceipt> {
  if (key.type !== "private" || key.algorithm.name !== "Ed25519" || !key.usages.includes("sign"))
    throw Error("Invalid runner signing key")
  // Snapshot before awaiting, so callers cannot substitute unsigned fields.
  const copy = JSON.parse(JSON.stringify(claim)) as RunnerCheckClaim
  const signature = await crypto.subtle.sign("Ed25519", key, claimBytes(keyId, copy))
  return { version: 1, keyId, claim: copy, signature: base64url(new Uint8Array(signature)) }
}

/** Trust is supplied by the host, never by a receipt's embedded public key. */
export async function verifyRunnerCheckReceipt(
  serialized: string | undefined, expected: HostedCheckIdentity, keys: ReadonlyMap<string, CryptoKey>,
): Promise<boolean> {
  try {
    if (!serialized || serialized.length > 24_576) return false
    const receipt = JSON.parse(serialized) as RunnerCheckReceipt
    if (!receipt || Object.keys(receipt).sort().join() !== "claim,keyId,signature,version" || receipt.version !== 1 ||
        !receipt.claim || Object.keys(receipt.claim).sort().join() !== "completedAt,exitCode,identity,runId,stderrDigest,stdoutDigest" ||
        !receipt.claim.identity || Object.keys(receipt.claim.identity).length !== 9 ||
        !/^[A-Za-z0-9_-]{86}$/.test(receipt.signature)) return false
    const key = keys.get(receipt.keyId)
    if (!key || key.type !== "public" || key.algorithm.name !== "Ed25519" || !key.usages.includes("verify")) return false
    const a = hostedCheckBytes(expected), b = hostedCheckBytes(receipt.claim.identity)
    if (a.length !== b.length || a.some((byte, i) => byte !== b[i])) return false
    const decoded = Uint8Array.from(atob(receipt.signature.replace(/-/g, "+").replace(/_/g, "/") + "=="), c => c.charCodeAt(0))
    if (base64url(decoded) !== receipt.signature) return false
    return await crypto.subtle.verify("Ed25519", key, decoded, claimBytes(receipt.keyId, receipt.claim))
  } catch { return false }
}

export interface RunnerCheckAuthority {
  readonly lookup: (identity: HostedCheckIdentity) => Promise<boolean>
  readonly record: (claim: RunnerCheckClaim) => Promise<void>
}

/** Remote and SCM runs share this adapter and authority. Local runs do not.
 * identify MUST inspect trusted prepared inputs, not a project-supplied digest.
 * A missing receipt/store failure is a miss. Failed commands never reach record.
 */
export function runnerCheckCache(options: {
  readonly runId: string
  readonly repository: string
  readonly identify: (request: CheckCacheRequest, phase: "before" | "after") => Promise<HostedCheckIdentity | undefined>
  readonly authority: RunnerCheckAuthority
  readonly now?: () => Date
}): CheckCache {
  const pending = new WeakMap<CheckCacheRequest, HostedCheckIdentity>()
  const matches = (request: CheckCacheRequest, identity: HostedCheckIdentity) => {
    const source = request.event.source
    return request.policy.scope === "commit" && source?.kind === "git" &&
      source.repository.replace(/\.git$/, "") === options.repository && identity.repository === options.repository &&
      source.revision === request.event.revision && identity.revision === source.revision &&
      identity.workflowId === request.workflowId && identity.stepId === request.stepId && identity.command === request.command
  }
  return {
    lookup: request => Effect.promise(async () => {
      pending.delete(request)
      try {
        const computed = await options.identify(request, "before")
        if (!computed || !matches(request, computed)) return false
        const identity = Object.freeze({ ...computed })
        hostedCheckBytes(identity)
        pending.set(request, identity)
        return await options.authority.lookup(identity)
      } catch { return false }
    }),
    record: (request, result?: CommandExecutionResult) => Effect.promise(async () => {
      const before = pending.get(request)
      pending.delete(request)
      if (!before || !result || result.exitCode !== 0) return
      const after = await options.identify(request, "after")
      if (!after || !matches(request, after) || await runnerCheckFingerprint(before) !== await runnerCheckFingerprint(after)) return
      await options.authority.record({ identity: before, runId: options.runId,
        completedAt: (options.now?.() ?? new Date()).toISOString(), exitCode: 0,
        stdoutDigest: await runnerReceiptDigest(encoder.encode(result.stdout)),
        stderrDigest: await runnerReceiptDigest(encoder.encode(result.stderr)) })
    }),
  }
}
