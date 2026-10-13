/** Trusted host-computed inputs, never a project's self-declared cache key. */
export interface HostedCheckIdentity {
  readonly kind: "check"
  readonly repository: string
  readonly revision: string
  readonly workflowId: string
  readonly stepId: string
  readonly command: string
  readonly policyDigest: string
  readonly toolchainDigest: string
  readonly sourceDigest: string
}

/** Host-owned enrollment. A valid signature alone does not authorize reuse. */
export interface HostedCheckEnrollment {
  readonly keyId: string
  readonly publicKey: CryptoKey
  readonly repository: string
  readonly checks: ReadonlyArray<{
    readonly workflowId: string
    readonly stepId: string
    readonly command: string
    readonly policyDigest: string
  }>
}

const fields = ["kind", "repository", "revision", "workflowId", "stepId", "command",
  "policyDigest", "toolchainDigest", "sourceDigest"] as const
const digest = /^[0-9a-f]{64}$/
const bounded = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max

/** Stable versioned bytes for a separate, explicit local signer. */
export const hostedCheckBytes = (identity: HostedCheckIdentity): Uint8Array<ArrayBuffer> => {
  if (!identity || identity.kind !== "check" ||
      !bounded(identity.repository, 512) || !/^https:\/\/[a-z0-9.-]+\/[\w.-]+\/[\w.-]+$/.test(identity.repository) ||
      !/^[0-9a-f]{40}$/.test(identity.revision) ||
      !bounded(identity.workflowId, 256) || !bounded(identity.stepId, 256) ||
      !bounded(identity.command, 8192) || !digest.test(identity.policyDigest) ||
      !digest.test(identity.toolchainDigest) || !digest.test(identity.sourceDigest)) {
    throw new Error("Incomplete hosted check identity")
  }
  return new TextEncoder().encode(JSON.stringify([
    "effect-ci-hosted-check", 1, ...fields.map((field) => identity[field]),
  ]))
}

/**
 * Read-only cryptographic primitive, NOT a wired CheckCache or trust enrollment.
 * The host supplies expected inputs and its enrolled public keys. A malformed,
 * absent, untrusted or mismatched note is a miss, so callers execute normally.
 * No Git subprocess, network request, secret key, or project code is involved.
 */
export const verifyHostedCheckEvidence = async (
  serialized: string | undefined,
  expected: HostedCheckIdentity,
  trustedKeys: ReadonlyMap<string, CryptoKey>,
): Promise<boolean> => {
  try {
    if (!serialized || serialized.length > 24_576) return false
    const evidence = JSON.parse(serialized) as {
      version?: unknown; keyId?: unknown; identity?: HostedCheckIdentity; signature?: unknown
    }
    if (!evidence || evidence.version !== 1 || !bounded(evidence.keyId, 64) ||
        !/^[a-zA-Z0-9_-]+$/.test(evidence.keyId) ||
        typeof evidence.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(evidence.signature) ||
        !evidence.identity || Object.keys(evidence.identity).length !== fields.length ||
        !fields.every((field) => Object.hasOwn(evidence.identity!, field))) return false
    const key = trustedKeys.get(evidence.keyId)
    if (!key || key.type !== "public" || key.algorithm.name !== "Ed25519" ||
        !key.usages.includes("verify")) return false
    const bytes = hostedCheckBytes(expected)
    const recorded = hostedCheckBytes(evidence.identity)
    if (bytes.length !== recorded.length || bytes.some((byte, i) => byte !== recorded[i])) return false
    const decoded = atob(evidence.signature.replace(/-/g, "+").replace(/_/g, "/") + "==")
    const signature = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
    // Reject noncanonical encodings, including unused trailing bits.
    if (btoa(String.fromCharCode(...signature)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_") !== evidence.signature)
      return false
    return await crypto.subtle.verify("Ed25519", key, signature, bytes)
  } catch {
    // Avoid echoing malformed notes, keys, project commands or credentials.
    return false
  }
}

/** Apply repository/check policy before cryptographic verification. This does
 * not compute prepared-source/toolchain inputs or install a native CheckCache.
 * Callers must keep enrollment and expected identity outside project control.
 */
export const verifyEnrolledCheckEvidence = async (
  serialized: string | undefined,
  expected: HostedCheckIdentity,
  enrollments: ReadonlyArray<HostedCheckEnrollment>,
): Promise<boolean> => {
  try {
    if (!Array.isArray(enrollments) || enrollments.length > 32) return false
    const ids = new Set<string>()
    const keys = new Map<string, CryptoKey>()
    for (const enrollment of enrollments) {
      if (!enrollment || !bounded(enrollment.keyId, 64) ||
          !/^[a-zA-Z0-9_-]+$/.test(enrollment.keyId) || ids.has(enrollment.keyId) ||
          !Array.isArray(enrollment.checks) || enrollment.checks.length > 32) return false
      ids.add(enrollment.keyId)
      if (expected.kind !== "check" || enrollment.repository !== expected.repository) continue
      if (enrollment.checks.some((check: HostedCheckEnrollment["checks"][number]) => check &&
          check.workflowId === expected.workflowId && check.stepId === expected.stepId &&
          check.command === expected.command && check.policyDigest === expected.policyDigest))
        keys.set(enrollment.keyId, enrollment.publicKey)
    }
    return await verifyHostedCheckEvidence(serialized, expected, keys)
  } catch {
    return false
  }
}
