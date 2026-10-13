import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { generateKeyPairSync } from "node:crypto"
import test from "node:test"
import { BROKEN_SOURCE, FIXED_SOURCE, REPAIR_BASE, REPAIR_COMMAND, REPAIR_PATH, REPAIR_REPOSITORY,
  proposeRepair, repairBlobHash, repairSource, repairTreeHash, withRepairInstallationToken,
  type GitTreeEntry, type RepairVerificationInput } from "./repair.ts"

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } })
const credentials = { appId: "5089816", privateKey }
const base = "a".repeat(40)
const candidate = "c".repeat(40)

async function harness() {
  const beforeBlob = await repairBlobHash(BROKEN_SOURCE)
  const nextBlob = await repairBlobHash(FIXED_SOURCE)
  const oldDirectory: GitTreeEntry[] = [{ path: "health.js", mode: "100644", type: "blob", sha: beforeBlob },
    { path: "health.test.mjs", mode: "100644", type: "blob", sha: "b".repeat(40) }]
  const oldDirectoryId = await repairTreeHash(oldDirectory)
  const oldRoot: GitTreeEntry[] = [{ path: "README.md", mode: "100644", type: "blob", sha: "d".repeat(40) },
    { path: "repair-demo", mode: "040000", type: "tree", sha: oldDirectoryId }]
  const oldRootId = await repairTreeHash(oldRoot)
  const nextDirectoryId = await repairTreeHash(oldDirectory.map(entry => entry.path === "health.js" ? { ...entry, sha: nextBlob } : entry))
  const nextRootId = await repairTreeHash(oldRoot.map(entry => entry.path === "repair-demo" ? { ...entry, sha: nextDirectoryId } : entry))
  const state = { branch: undefined as string | undefined, message: "", pr: undefined as any,
    writes: [] as string[], revoked: 0, loseRef: false, losePR: false, drift: false, foreignTree: false, unsafeTree: false }
  const fetcher: typeof fetch = async (raw, init) => {
    const url = new URL(String(raw))
    assert.equal(url.origin, "https://api.github.com")
    assert.equal(init?.redirect, "manual")
    assert.ok(init?.signal)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (url.pathname === "/app/installations/165265172/access_tokens") {
      assert.deepEqual(body, { repositories: ["effect-ci-private-github-fixture"], permissions: { contents: "write", pull_requests: "write" } })
      return Response.json({ token: "scoped-test-token", permissions: { contents: "write", pull_requests: "write", metadata: "read" } })
    }
    if (url.pathname === "/installation/token") { assert.equal(init?.method, "DELETE"); state.revoked++; return new Response(null, { status: 204 }) }
    assert.ok(url.pathname.startsWith(`/repos/${REPAIR_REPOSITORY}/`))
    const path = url.pathname.slice(`/repos/${REPAIR_REPOSITORY}`.length)
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer scoped-test-token")
    if (init?.method === "POST") state.writes.push(path)
    const ref = (name: string, sha: string) => Response.json({ ref: `refs/heads/${name}`, object: { type: "commit", sha } })
    if (path === `/git/ref/heads/${REPAIR_BASE}`) return ref(REPAIR_BASE, state.drift ? "e".repeat(40) : base)
    if (path === "/git/ref/heads/codex/repair-owned") return state.branch ? ref("codex/repair-owned", state.branch) : new Response("missing", { status: 404 })
    if (path === `/git/commits/${base}`) return Response.json({ sha: base, tree: { sha: oldRootId } })
    if (path === `/git/trees/${oldRootId}`) return Response.json({ sha: oldRootId, tree: state.unsafeTree ? [{ ...oldRoot[0], mode: "120000" }, oldRoot[1]] : oldRoot, truncated: false })
    if (path === `/git/trees/${oldDirectoryId}`) return Response.json({ sha: oldDirectoryId, tree: oldDirectory, truncated: false })
    if (path === `/git/blobs/${beforeBlob}`) return Response.json({ sha: beforeBlob, content: btoa(BROKEN_SOURCE), encoding: "base64" })
    if (path === "/git/blobs") { assert.deepEqual(body, { content: FIXED_SOURCE, encoding: "utf-8" }); return Response.json({ sha: nextBlob }) }
    if (path === "/git/trees") {
      assert.deepEqual(body, { base_tree: oldRootId, tree: [{ path: REPAIR_PATH, mode: "100644", type: "blob", sha: nextBlob }] })
      return Response.json({ sha: nextRootId })
    }
    if (path === "/git/commits") {
      assert.equal(body.tree, nextRootId); assert.deepEqual(body.parents, [base]); state.message = body.message
      return Response.json({ sha: candidate })
    }
    if (path === "/git/refs") {
      assert.deepEqual(body, { ref: "refs/heads/codex/repair-owned", sha: candidate })
      assert.equal(state.branch, undefined, "never replace an existing ref")
      state.branch = candidate
      if (state.loseRef) { state.loseRef = false; throw new Error("secret reflected in transport") }
      return Response.json({ ref: body.ref, object: { type: "commit", sha: candidate } })
    }
    if (path === `/git/commits/${candidate}`) return Response.json({ sha: candidate, tree: { sha: state.foreignTree ? "f".repeat(40) : nextRootId }, parents: [{ sha: base }], message: state.message })
    if (path === "/pulls" && init?.method === "GET") {
      assert.equal(url.searchParams.get("head"), "ericclemmons:codex/repair-owned")
      assert.equal(url.searchParams.get("base"), REPAIR_BASE)
      return Response.json(state.pr ? [state.pr] : [])
    }
    if (path === "/pulls" && init?.method === "POST") {
      assert.equal(body.base, REPAIR_BASE); assert.equal(body.head, "codex/repair-owned")
      assert.equal(state.pr, undefined, "never duplicate a PR")
      state.pr = { number: 1, title: body.title, body: body.body, user: { login: "effect-ci-testbed[bot]" }, state: "open",
        head: { ref: body.head, sha: candidate }, base: { ref: body.base } }
      if (state.losePR) { state.losePR = false; throw new Error("lost acknowledgement") }
      return Response.json(state.pr)
    }
    assert.fail(`Unexpected fixed API path: ${path}`)
  }
  const verify = async (input: RepairVerificationInput) => {
    assert.equal(state.branch, candidate, "commit/ref exists before verification")
    assert.equal(input.repository, REPAIR_REPOSITORY); assert.equal(input.commit, candidate)
    assert.equal(input.path, REPAIR_PATH); assert.equal(input.source, FIXED_SOURCE); assert.equal(input.command, REPAIR_COMMAND)
    return { commit: input.commit, sourceDigest: input.sourceDigest, passed: true as const, evidenceId: "owned-check-receipt" }
  }
  const run = (check = verify) => proposeRepair(credentials, { runId: "owned", baseCommit: base,
    proposedText: "```javascript\nexport function healthStatus() { return 200; }\n```" }, check, fetcher)
  return { state, fetcher, verify, run }
}

test("Git tree hash matches independent git implementation, including directory sort and mode", async () => {
  const entries: GitTreeEntry[] = [{ path: "dir", mode: "040000", type: "tree", sha: "a".repeat(40) },
    { path: "dir.txt", mode: "100755", type: "blob", sha: "b".repeat(40) }]
  const raw = Buffer.concat([Buffer.from("100755 dir.txt\0"), Buffer.from("b".repeat(40), "hex"),
    Buffer.from("40000 dir\0"), Buffer.from("a".repeat(40), "hex")])
  const independent = execFileSync("git", ["hash-object", "-t", "tree", "--stdin"], { input: raw, encoding: "utf8" }).trim()
  assert.equal(await repairTreeHash(entries), independent)
  assert.equal(await repairTreeHash([]), "4b825dc642cb6eb9a060e54bf8d69288fbee4904")
})
test("model text becomes one canonical allowed change, never executable arbitrary output", () => {
  assert.equal(repairSource(FIXED_SOURCE), FIXED_SOURCE)
  for (const bad of [null, BROKEN_SOURCE, FIXED_SOURCE + "fetch('https://escape.invalid');", "export function other() { return 200; }",
    "Explanation\n" + FIXED_SOURCE, "```js\n" + FIXED_SOURCE, "x".repeat(1025)]) assert.throws(() => repairSource(bad), /policy rejected/)
})
test("fixed one-file repair verifies exact commit before one proposed PR; replay creates nothing", async () => {
  const h = await harness()
  const first = await h.run()
  assert.equal(first.created, true); assert.equal(first.commit, candidate); assert.equal(first.deploymentPerformed, false)
  assert.equal(first.url, `https://github.com/${REPAIR_REPOSITORY}/pull/1`)
  assert.deepEqual(h.state.writes, ["/git/blobs", "/git/trees", "/git/commits", "/git/refs", "/pulls"])
  const second = await h.run()
  assert.equal(second.created, false); assert.equal(h.state.writes.length, 5); assert.equal(h.state.revoked, 2)
})
test("lost branch and PR acknowledgements reconcile without blind retries or duplicates", async () => {
  for (const lost of ["loseRef", "losePR"] as const) {
    const h = await harness(); h.state[lost] = true
    await assert.rejects(h.run(), { message: "Repair API transport failed; reconcile before retrying" })
    assert.equal(h.state.revoked, 1)
    const result = await h.run()
    assert.equal(result.pullRequest, 1)
    assert.equal(h.state.writes.filter(path => path === "/git/refs").length, 1)
    assert.equal(h.state.writes.filter(path => path === "/pulls").length, 1)
  }
})
test("failed or mismatched verification never proposes a PR, and revokes writer token", async () => {
  for (const bad of [async () => { throw new Error("secret in test failure") },
    async (input: RepairVerificationInput) => ({ commit: base, sourceDigest: input.sourceDigest, passed: true as const, evidenceId: "wrong-commit" })]) {
    const h = await harness()
    await assert.rejects(h.run(bad as any), { message: "Repair exact-commit verification failed; no PR created" })
    assert.equal(h.state.pr, undefined); assert.equal(h.state.revoked, 1)
  }
})
test("base drift, symlinks, foreign tree and foreign PR identity fail closed", async () => {
  const drift = await harness(); drift.state.drift = true
  await assert.rejects(drift.run(), /base changed/); assert.equal(drift.state.writes.length, 0)
  const unsafe = await harness(); unsafe.state.unsafeTree = true
  await assert.rejects(unsafe.run(), /policy rejected/); assert.equal(unsafe.state.writes.length, 0)
  const foreign = await harness(); await foreign.run(); foreign.state.foreignTree = true
  await assert.rejects(foreign.run(), /not the exact owned patch/)
  const pr = await harness(); await pr.run(); pr.state.pr.user.login = "someone-else"
  await assert.rejects(pr.run(), /PR identity did not match/); assert.equal(pr.state.writes.length, 5)
  const during = await harness()
  await assert.rejects(during.run(async input => { const receipt = await during.verify(input); during.state.drift = true; return receipt }), /refs changed/)
  assert.equal(during.state.pr, undefined)
})
test("unsafe inputs fail before token minting; extra token permissions revoke without writing", async () => {
  const h = await harness()
  await assert.rejects(proposeRepair(credentials, { runId: "../escape", baseCommit: base, proposedText: FIXED_SOURCE }, h.verify, async () => { assert.fail("mint reached") }), /policy rejected/)
  let revoked = 0
  await assert.rejects(withRepairInstallationToken(credentials, async () => { assert.fail("writer reached") }, async (url, init) => {
    if (init?.method === "DELETE") { revoked++; return new Response(null, { status: 204 }) }
    return Response.json({ token: "test", permissions: { contents: "write", pull_requests: "write", issues: "write" } })
  }), /permissions rejected/)
  assert.equal(revoked, 1)
  await assert.rejects(withRepairInstallationToken({ ...credentials, appId: "other" }, async () => {}), /policy rejected/)
})

test("redirect, reflected error body and broken response streams never expose credentials", async () => {
  for (const response of [new Response("reflected-secret", { status: 403 }),
    new Response("reflected-secret", { status: 302, headers: { location: "https://escape.invalid" } })]) {
    await assert.rejects(withRepairInstallationToken(credentials, async () => {}, async () => response), /^Error: Repair API request failed \((403|302)\)$/)
  }
  await assert.rejects(withRepairInstallationToken(credentials, async () => {}, async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error("secret in upstream stream")) },
  }))), { message: "Repair API returned invalid data" })
  await assert.rejects(withRepairInstallationToken(credentials, async () => {}, async () => Response.json({ value: "x".repeat(65537) })),
    { message: "Repair API returned invalid data" })
})
