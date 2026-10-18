import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { runnerCheckCache, runnerCheckFingerprint, signRunnerCheckReceipt, verifyRunnerCheckReceipt,
  type RunnerCheckClaim } from "./runner-check-receipt.ts"
import type { HostedCheckIdentity } from "./check-evidence.ts"

const identity: HostedCheckIdentity = { kind: "check", repository: "https://github.com/owner/repo",
  revision: "a".repeat(40), workflowId: "demo", stepId: "test", command: "pnpm test",
  policyDigest: "b".repeat(64), toolchainDigest: "c".repeat(64), sourceDigest: "d".repeat(64) }
const pair = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]) as CryptoKeyPair
const keys = new Map([["trusted-host", pair.publicKey]])
const claim: RunnerCheckClaim = { identity, runId: "remote-1", completedAt: "2026-10-17T00:00:00.000Z",
  exitCode: 0, stdoutDigest: "e".repeat(64), stderrDigest: "f".repeat(64) }
const request: CI.CheckCacheRequest = { workflowId: identity.workflowId, stepId: identity.stepId,
  command: identity.command, policy: { scope: "commit" }, workspace: CI.Workspace.local("/fixture"),
  event: { type: "push", revision: identity.revision,
    source: { kind: "git", repository: identity.repository, revision: identity.revision } } }
const result = { exitCode: 0, stdout: "tests passed", stderr: "" }

test("runner signs execution, output digests and exact inputs; embedded trust and tampering fail", async () => {
  const receipt = await signRunnerCheckReceipt("trusted-host", pair.privateKey, claim)
  const serialized = JSON.stringify(receipt)
  assert.equal(await verifyRunnerCheckReceipt(serialized, identity, keys), true)
  for (const changed of [{ revision: "e".repeat(40) }, { repository: "https://github.com/other/repo" },
    { workflowId: "other" }, { stepId: "build" }, { command: "pnpm deploy" },
    { policyDigest: "e".repeat(64) }, { sourceDigest: "e".repeat(64) }, { toolchainDigest: "e".repeat(64) }])
    assert.equal(await verifyRunnerCheckReceipt(serialized, { ...identity, ...changed }, keys), false)
  for (const changed of [{ runId: "other" }, { completedAt: "2026-10-18T00:00:00.000Z" },
    { stdoutDigest: "0".repeat(64) }, { stderrDigest: "0".repeat(64) }, { exitCode: 1 }, { extra: "ambiguity" }])
    assert.equal(await verifyRunnerCheckReceipt(JSON.stringify({ ...receipt, claim: { ...claim, ...changed } }), identity, keys), false)
  assert.equal(await verifyRunnerCheckReceipt(serialized, identity, new Map()), false)
  assert.equal(await verifyRunnerCheckReceipt(JSON.stringify({ ...receipt, publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey) }), identity, keys), false)
  for (const value of [undefined, "null", "{}", "not json", "x".repeat(24_577)])
    assert.equal(await verifyRunnerCheckReceipt(value, identity, keys), false)
  await assert.rejects(signRunnerCheckReceipt("trusted-host", pair.privateKey, { ...claim, exitCode: 1 } as unknown as RunnerCheckClaim))
})

test("real CI remote verification is reused by SCM; actions and changed commits still execute", async () => {
  const receipts = new Map<string, string>(); let executions = 0, builds = 0, records = 0
  const authority = {
    lookup: async (expected: HostedCheckIdentity) => verifyRunnerCheckReceipt(receipts.get(await runnerCheckFingerprint(expected)), expected, keys),
    record: async (input: RunnerCheckClaim) => {
      records++
      receipts.set(await runnerCheckFingerprint(input.identity), JSON.stringify(await signRunnerCheckReceipt("trusted-host", pair.privateKey, input)))
    },
  }
  const check = CI.check("test", () => function* () { yield* request.workspace.exec(identity.command) }, { reuse: { scope: "commit" } })
  const build = CI.action("build", () => function* () { yield* check(); return yield* request.workspace.exec("pnpm build") })
  const workflow = CI.workflow(identity.workflowId, () => build())
  const events: CI.RuntimeEvent[][] = []
  for (const [runId, revision] of [["remote-1", identity.revision], ["scm-1", identity.revision], ["squashed", "e".repeat(40)]] as const) {
    const runEvents: CI.RuntimeEvent[] = []; events.push(runEvents)
    await CI.runPromise(workflow, { output: "silent", event: { ...request.event, revision,
      source: { kind: "git", repository: identity.repository, revision } },
      executor: { execute: input => Effect.sync(() => { if (input.stepId === "test") executions++; else builds++; return result }) },
      checkCache: runnerCheckCache({ runId, repository: identity.repository, authority,
        identify: async input => ({ ...identity, revision: input.event.revision! }) }),
      onEvent: event => { runEvents.push(event) },
    })
  }
  assert.equal(executions, 2); assert.equal(records, 2); assert.equal(builds, 3)
  assert.ok(events[1]!.some(e => e.type === "step.status" && e.stepId === "test" && e.status === "verified"))
  const stored = JSON.parse(receipts.values().next().value!)
  assert.equal(stored.claim.runId, "remote-1")
  assert.notEqual(stored.claim.stdoutDigest, stored.claim.stderrDigest)
  assert.doesNotMatch(JSON.stringify(stored), /tests passed/)
})

test("no proof is minted for failed, missing, changed or unidentified execution", async () => {
  let writes = 0
  for (const scenario of ["failed", "missing-result", "changed-inputs", "no-identity", "foreign-event", "store-down"] as const) {
    const input = scenario === "foreign-event" ? { ...request, event: { ...request.event, revision: "e".repeat(40) } } : { ...request }
    const cache = runnerCheckCache({ runId: "remote", repository: identity.repository,
      identify: async (_request, phase) => scenario === "no-identity" ? undefined :
        { ...identity, ...(scenario === "changed-inputs" && phase === "after" ? { sourceDigest: "e".repeat(64) } : {}) },
      authority: { lookup: async () => { if (scenario === "store-down") throw Error("offline"); return false },
        record: async () => { writes++ } },
    })
    assert.equal(await Effect.runPromise(cache.lookup(input)), false)
    // A lookup outage still permits successful execution to record; no outage
    // authorizes reuse. This particular test omits execution after that miss.
    if (scenario !== "store-down") await Effect.runPromise(cache.record(input,
      scenario === "missing-result" ? undefined : { ...result, exitCode: scenario === "failed" ? 1 : 0 }))
  }
  assert.equal(writes, 0)
})
