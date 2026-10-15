import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { hostedCheckCache } from "./check-cache.ts"
import { hostedCheckBytes, type HostedCheckIdentity } from "./check-evidence.ts"

const revision = "a".repeat(40)
const identity: HostedCheckIdentity = {
  kind: "check", repository: "https://github.com/owner/fixture", revision,
  workflowId: "hosted-reuse-lab", stepId: "syntax", command: "node --check app.js",
  policyDigest: "b".repeat(64), toolchainDigest: "c".repeat(64), sourceDigest: "d".repeat(64),
}
const keys = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]) as CryptoKeyPair
const enrollment = {
  keyId: "ephemeral-lab", publicKey: keys.publicKey, repository: identity.repository,
  checks: [{ workflowId: identity.workflowId, stepId: identity.stepId,
    command: identity.command, policyDigest: identity.policyDigest }],
}
const sign = async (input = identity) => JSON.stringify({ version: 1,
  keyId: enrollment.keyId, identity: input,
  signature: Buffer.from(await crypto.subtle.sign("Ed25519", keys.privateKey, hostedCheckBytes(input))).toString("base64url"),
})
const harness = (note: string | undefined, expected: HostedCheckIdentity | undefined = identity,
  enrollments = [enrollment]) => {
  const calls: string[] = []
  const blobSha = createHash("sha1").update(`blob ${Buffer.byteLength(note ?? "")}\0`).update(note ?? "").digest("hex")
  const replies = [
    { ref: "refs/notes/effect-ci-hosted-checks-v1", object: { type: "commit", sha: "e".repeat(40) } },
    { sha: "e".repeat(40), tree: { sha: "f".repeat(40) } },
    { sha: "f".repeat(40), truncated: false, tree: [{ path: revision, type: "blob", mode: "100644", sha: blobSha }] },
    { sha: blobSha, encoding: "base64", size: Buffer.byteLength(note ?? ""), content: Buffer.from(note ?? "").toString("base64") },
  ]
  const cache = hostedCheckCache({
    identify: async () => expected, enrollments,
    reader: { repository: "owner/fixture", request: async (url, init) => {
      calls.push(url); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error")
      return new Response(JSON.stringify(note === undefined ? {} : replies[calls.length - 1]),
        { status: note === undefined ? 404 : 200 })
    } },
  })
  return { cache, calls }
}
const request: CI.CheckCacheRequest = {
  command: identity.command, workflowId: identity.workflowId, stepId: identity.stepId,
  policy: { scope: "commit" }, workspace: CI.Workspace.local("/lab"),
  event: { type: "push", revision,
    source: { kind: "git", repository: identity.repository, revision } },
}

test("adapter composes pinned note integrity, enrollment and exact-input signature; record is read-only", async () => {
  const h = harness(await sign())
  assert.equal(await Effect.runPromise(h.cache.lookup(request)), true)
  assert.equal(h.calls.length, 4)
  await Effect.runPromise(h.cache.record(request))
  assert.equal(h.calls.length, 4)
  for (const url of h.calls) assert.ok(url.startsWith("https://api.github.com/repos/owner/fixture/git/"))
  const cloneUrl = harness(await sign())
  assert.equal(await Effect.runPromise(cloneUrl.cache.lookup({ ...request,
    event: { ...request.event, source: { kind: "git", repository: identity.repository + ".git", revision } },
  })), true)
})

test("missing, invalid, unknown/revoked trust and changed inputs are ordinary misses", async () => {
  for (const note of [undefined, "advisory unsigned receipt", "{}",
    JSON.stringify({ ...JSON.parse(await sign()), signature: "A".repeat(86) })]) {
    assert.equal(await Effect.runPromise(harness(note).cache.lookup(request)), false)
  }
  for (const changed of [{ revision: "e".repeat(40) }, { repository: "https://github.com/other/repo" },
    { workflowId: "release" }, { stepId: "deploy" }, { command: "node deploy.js" },
    { policyDigest: "e".repeat(64) }, { toolchainDigest: "e".repeat(64) }, { sourceDigest: "e".repeat(64) }]) {
    assert.equal(await Effect.runPromise(harness(await sign(), { ...identity, ...changed }).cache.lookup(request)), false)
  }
  assert.equal(await Effect.runPromise(harness(await sign(), identity, []).cache.lookup(request)), false)
  const denied = hostedCheckCache({ identify: async () => undefined, enrollments: [enrollment],
    reader: { repository: "owner/fixture", request: async () => { assert.fail("ineligible lookup reached network") } } })
  assert.equal(await Effect.runPromise(denied.lookup(request)), false)
})

test("foreign/event-mismatched/non-Git identities fail before note retrieval", async () => {
  for (const event of [{ ...request.event, revision: "e".repeat(40) },
    { type: "workflow_dispatch" as const },
    { ...request.event, source: { kind: "git" as const, repository: "https://github.com/foreign/repo", revision } }]) {
    const h = harness(await sign())
    assert.equal(await Effect.runPromise(h.cache.lookup({ ...request, event })), false)
    assert.equal(h.calls.length, 0)
  }
})

test("actual CI executes real local Node on misses, skips only signed check hits, never skips an action", async () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-check-cache-"))
  writeFileSync(join(root, "app.js"), "export const answer = 42\n")
  const checkout = CI.action("prepare", () => function* () { return CI.Workspace.local(root) })
  const syntax = CI.check("syntax", () => function* () {
    const workspace = yield* checkout()
    yield* workspace.exec(identity.command)
  }, { reuse: { scope: "commit" } })
  const action = CI.action("ordinary action", () => function* () {
    yield* syntax()
    const workspace = yield* checkout()
    yield* workspace.exec(identity.command)
    return workspace
  })
  const workflow = CI.workflow(identity.workflowId, () => action())
  let checks = 0, actions = 0
  const executor: CI.CommandExecutor = { execute: command => Effect.sync(() => {
    if (command.stepId === identity.stepId) checks++; else actions++
    const stdout = execFileSync(process.execPath, ["--check", "app.js"],
      { cwd: root, encoding: "utf8", env: {} })
    return { exitCode: 0, stderr: "", stdout }
  }) }
  for (const note of [undefined, await sign(), "invalid signature", await sign()]) {
    const result = await CI.runPromise(workflow, { event: request.event, executor,
      output: "silent", checkCache: harness(note).cache })
    assert.equal(result.plan.nodes.find(node => node.id === "syntax")?.status,
      note?.startsWith('{"version":1') ? "verified" : "complete")
  }
  assert.equal(checks, 2); assert.equal(actions, 4)
  // Real local Node and actual CI orchestration; fake GitHub, synthetic identity
  // digests and ephemeral key. NOT native hosted execution or enrolled demo proof.
})
