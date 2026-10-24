import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import { identifyFlywheel, repository, command, buildBytes, verifyBuild, digest } from "./flywheel-identity.ts"
import trust from "./flywheel-trust.ts"

const revision = "a".repeat(40)
const request: CI.CheckCacheRequest = { workflowId: "release-flywheel", stepId: "worker-tests", command,
  policy: { scope: "commit" }, workspace: CI.Workspace.local("/lab"),
  event: { type: "push", revision, source: { kind: "git", repository, revision } } }
const read = async (path: string) => readFileSync(new URL(`../../../examples/release-flywheel/${path}`, import.meta.url), "utf8")
const runtime = async () => JSON.stringify({ node: "24.22.1", v8: "13.6.233.17-node.40" })

test("identities use prepared bytes and measured runtime; reviewed fixture is the eligibility boundary", async () => {
  const identity = await identifyFlywheel(request, read, runtime, trust.sourceDigest)
  assert.ok(identity)
  assert.equal(identity.sourceDigest, trust.sourceDigest)
  assert.equal(await identifyFlywheel(request, async path => (await read(path)) + "// changed", runtime, trust.sourceDigest), undefined)
  assert.equal(await identifyFlywheel(request, async () => undefined, runtime, trust.sourceDigest), undefined)
  assert.equal(await identifyFlywheel({ ...request, stepId: "deploy" }, read, runtime, trust.sourceDigest), undefined)
  assert.equal(await identifyFlywheel({ ...request, command: "node deploy.js" }, read, runtime, trust.sourceDigest), undefined)
  const changed = await identifyFlywheel(request, read, async () => JSON.stringify({ node: "24.23.0", v8: "changed" }), trust.sourceDigest)
  assert.notEqual(changed?.toolchainDigest, identity.toolchainDigest)
})

test("signed upload receipt binds the exact tested module, commit and candidate version", async () => {
  const keys = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]) as CryptoKeyPair
  const module = await read("worker.mjs")
  const body = { version: "12345678-1234-1234-1234-123456789012", revision, moduleDigest: await digest(module) }
  const receipt = { ...body, signature: Buffer.from(await crypto.subtle.sign("Ed25519", keys.privateKey, buildBytes(body))).toString("base64url") }
  assert.equal(await verifyBuild(receipt, revision, module, keys.publicKey), true)
  assert.equal(await verifyBuild(receipt, "b".repeat(40), module, keys.publicKey), false)
  assert.equal(await verifyBuild(receipt, revision, module + "// changed", keys.publicKey), false)
  assert.equal(await verifyBuild({ ...receipt, version: "22345678-1234-1234-1234-123456789012" }, revision, module, keys.publicKey), false)
  assert.equal(await verifyBuild({ ...receipt, signature: "A".repeat(86) }, revision, module, keys.publicKey), false)
})
