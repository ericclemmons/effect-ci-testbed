import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { runnerWorkspaceResultCache, signRunnerStepReceipt, verifyRunnerStepReceipt,
  type RunnerStepIdentity, type RunnerStepClaim, type RunnerWorkspaceResult } from "./runner-step-result.ts"

const identity: RunnerStepIdentity = { kind: "step-result", repository: "https://github.com/owner/repo",
  revision: "a".repeat(40), workflowId: "demo", stepId: "build", policyDigest: "b".repeat(64), runtimeDigest: "c".repeat(64) }
const result: RunnerWorkspaceResult = { kind: "workspace", provider: "cloudflare-container",
  cwd: "/workspace/repository/test/fixtures/demo", snapshot: { id: "immutable-build-1", size: 1024, name: "build-workspace" } }
const claim: RunnerStepClaim = { identity, result, conclusion: "success", runId: "producer", completedAt: "2026-10-17T00:00:00.000Z" }
const pair = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]) as CryptoKeyPair
const keys = new Map([["host", pair.publicKey]])

test("step receipt binds the immutable output handle as well as source, policy and runtime", async () => {
  const receipt = await signRunnerStepReceipt("host", pair.privateKey, claim)
  const text = JSON.stringify(receipt)
  assert.deepEqual(await verifyRunnerStepReceipt(text, identity, keys), result)
  for (const changed of [{ revision: "e".repeat(40) }, { repository: "https://github.com/other/repo" },
    { workflowId: "other" }, { stepId: "deploy" }, { policyDigest: "e".repeat(64) }, { runtimeDigest: "e".repeat(64) }])
    assert.equal(await verifyRunnerStepReceipt(text, { ...identity, ...changed }, keys), undefined)
  for (const changed of [{ cwd: "/workspace/repository/other" }, { snapshot: { ...result.snapshot, id: "other" } },
    { snapshot: { ...result.snapshot, size: 2048 } }, { snapshot: { ...result.snapshot, name: "other" } },
    { provider: "other" }, { extra: "unsigned field" }])
    assert.equal(await verifyRunnerStepReceipt(JSON.stringify({ ...receipt, claim: { ...claim, result: { ...result, ...changed } } }), identity, keys), undefined)
  assert.equal(await verifyRunnerStepReceipt(text, identity, new Map()), undefined)
  await assert.rejects(signRunnerStepReceipt("host", pair.privateKey, { ...claim, conclusion: "failure" } as unknown as RunnerStepClaim))
  await assert.rejects(signRunnerStepReceipt("host", pair.privateKey, { ...claim, result: { ...result, cwd: "/workspace/repository/../outside" } }))
  for (const text of [undefined, "{}", "null", "not json", "x".repeat(24_577)])
    assert.equal(await verifyRunnerStepReceipt(text, identity, keys), undefined)
})

test("only an eligible Git identity reaches the authority; unavailable artifacts miss and a rebuild may record a fresh result", async () => {
  const request: CI.StepResultCacheRequest = { workflowId: identity.workflowId, stepId: identity.stepId,
    event: { type: "push", revision: identity.revision, source: { kind: "git", repository: identity.repository, revision: identity.revision } } }
  let reads = 0, writes = 0, restores = 0
  const cache = runnerWorkspaceResultCache({ runId: "consumer", identify: async () => identity,
    authority: { stepResult: async () => { reads++; return result }, recordStepResult: async value => {
      writes++; assert.equal(value.result.snapshot.id, "fresh-build"); assert.equal(value.runId, "consumer")
    } },
    restore: async () => { restores++; throw Error("snapshot expired") },
    capture: async value => value instanceof CI.Workspace ? { ...result, snapshot: { id: "fresh-build", size: 2 } } : undefined,
  })
  for (const event of [{ type: "workflow_dispatch" as const }, { ...request.event, revision: "e".repeat(40) },
    { ...request.event, source: { kind: "git" as const, repository: "https://github.com/other/repo", revision: identity.revision } }])
    assert.equal(await Effect.runPromise(cache.lookup({ ...request, event })), undefined)
  assert.equal(reads, 0)
  // The kernel turns this typed restore failure into a normal execution miss.
  await assert.rejects(Effect.runPromise(cache.lookup(request)), /snapshot expired/)
  await Effect.runPromise(cache.record(request, CI.Workspace.remote("consumer", result.cwd)))
  assert.equal(reads, 1); assert.equal(restores, 1); assert.equal(writes, 1)
})
