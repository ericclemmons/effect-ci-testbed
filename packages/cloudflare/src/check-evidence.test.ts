import assert from "node:assert/strict"
import { test } from "node:test"
import { hostedCheckBytes, verifyHostedCheckEvidence, verifyEnrolledCheckEvidence, type HostedCheckIdentity, type HostedCheckEnrollment } from "./check-evidence.ts"

const identity: HostedCheckIdentity = {
  kind: "check", repository: "https://github.com/example/fixture", revision: "a".repeat(40),
  workflowId: "fixture", stepId: "lint", command: "node --check app/index.js",
  policyDigest: "b".repeat(64), toolchainDigest: "c".repeat(64), sourceDigest: "d".repeat(64),
}
const keyPair = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]) as CryptoKeyPair
const keys = new Map([["lab-only", keyPair.publicKey]])
const sign = async (input: HostedCheckIdentity = identity) => {
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", keyPair.privateKey, hostedCheckBytes(input)))
  return JSON.stringify({ version: 1, keyId: "lab-only", identity: input,
    signature: btoa(String.fromCharCode(...signature)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_") })
}

test("WebCrypto verifier accepts only the enrolled exact-input check", async () => {
  const note = await sign()
  assert.equal(await verifyHostedCheckEvidence(note, identity, keys), true)
  assert.equal(await verifyHostedCheckEvidence(note, identity, new Map()), false)
  assert.equal(await verifyHostedCheckEvidence(undefined, identity, keys), false)
})

test("every repository, commit, check, command, policy, toolchain and prepared-source input is bound", async () => {
  const note = await sign()
  for (const changed of [
    { repository: "https://github.com/other/fixture" }, { revision: "e".repeat(40) },
    { workflowId: "other" }, { stepId: "test" }, { command: "node test.js" },
    { policyDigest: "e".repeat(64) }, { toolchainDigest: "e".repeat(64) }, { sourceDigest: "e".repeat(64) },
  ]) assert.equal(await verifyHostedCheckEvidence(note, { ...identity, ...changed }, keys), false)
})

test("malformed, tampered and legacy/advisory notes miss without changing trust", async () => {
  const note = await sign()
  const parsed = JSON.parse(note)
  for (const bad of ["{}", "null", "not json", "x".repeat(24_577),
    JSON.stringify({ ...parsed, version: 2 }), JSON.stringify({ ...parsed, keyId: "unknown" }),
    JSON.stringify({ ...parsed, signature: "A".repeat(86) }),
    JSON.stringify({ ...parsed, identity: { ...identity, command: "different" } }),
    JSON.stringify({ ...parsed, identity: { ...identity, extra: "unsigned ambiguity" } }),
    JSON.stringify([{ fingerprint: "legacy", signature: parsed.signature }]),
  ]) assert.equal(await verifyHostedCheckEvidence(bad, identity, keys), false)
  const hmac = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
  assert.equal(await verifyHostedCheckEvidence(note, identity, new Map([["lab-only", hmac]])), false)
})

test("incomplete or credential-bearing identities and ordinary actions cannot be signed or reused", async () => {
  const note = await sign()
  for (const changed of [
    { kind: "action" }, { revision: "main" }, { repository: "https://token@github.com/example/fixture" },
    { sourceDigest: "" }, { toolchainDigest: "unknown" }, { command: "" },
  ]) {
    const invalid = { ...identity, ...changed } as HostedCheckIdentity
    assert.throws(() => hostedCheckBytes(invalid))
    assert.equal(await verifyHostedCheckEvidence(note, invalid, keys), false)
  }
})

const enrollment: HostedCheckEnrollment = {
  keyId: "lab-only", publicKey: keyPair.publicKey, repository: identity.repository,
  checks: [{ workflowId: identity.workflowId, stepId: identity.stepId,
    command: identity.command, policyDigest: identity.policyDigest }],
}

test("an enrolled signer cannot authorize a different repository, workflow, check, command or policy", async () => {
  assert.equal(await verifyEnrolledCheckEvidence(await sign(), identity, [enrollment]), true)
  for (const changed of [
    { repository: "https://github.com/other/fixture" }, { workflowId: "release" },
    { stepId: "build" }, { command: "node deploy.js" }, { policyDigest: "e".repeat(64) },
  ]) {
    const other = { ...identity, ...changed }
    // Even a genuinely valid fresh signature from this key is outside policy.
    assert.equal(await verifyHostedCheckEvidence(await sign(other), other, keys), true)
    assert.equal(await verifyEnrolledCheckEvidence(await sign(other), other, [enrollment]), false)
  }
})

test("removing a key or check revokes reuse; ambiguous and oversized enrollment misses", async () => {
  const note = await sign()
  for (const policy of [[], [{ ...enrollment, checks: [] }], [enrollment, enrollment],
    Array(33).fill(enrollment), [{ ...enrollment, checks: Array(33).fill(enrollment.checks[0]) }]])
    assert.equal(await verifyEnrolledCheckEvidence(note, identity, policy), false)
  assert.equal(await verifyEnrolledCheckEvidence(note, identity,
    [{ ...enrollment, keyId: "rotated-key" }]), false)
  assert.equal(await verifyEnrolledCheckEvidence(note, { ...identity, kind: "action" } as unknown as HostedCheckIdentity,
    [enrollment]), false)
})
