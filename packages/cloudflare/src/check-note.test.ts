import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { readGitHubCheckNote } from "./check-note.ts"

const revision = "a".repeat(40)
const notesCommit = "b".repeat(40)
const treeSha = "c".repeat(40)
const text = '{"version":1,"test":"unsigned reader fixture, not accepted proof"}\n'
const blobSha = createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex")
const fixture = (fanout = true) => [
  { ref: "refs/notes/effect-ci-hosted-checks-v1", object: { type: "commit", sha: notesCommit } },
  { sha: notesCommit, tree: { sha: treeSha } },
  { sha: treeSha, truncated: false, tree: [{ path: fanout ? `${revision.slice(0, 2)}/${revision.slice(2)}` : revision,
    type: "blob", mode: "100644", sha: blobSha }] },
  { sha: blobSha, encoding: "base64", size: Buffer.byteLength(text), content: btoa(text) },
]
const reader = (replies: unknown[], status = 200) => {
  const calls: string[] = []
  const request = async (url: string, init: RequestInit) => {
    calls.push(url)
    assert.equal(init.method, "GET"); assert.equal(init.redirect, "error")
    assert.equal(new URL(url).origin, "https://api.github.com")
    assert.ok(url.startsWith("https://api.github.com/repos/owner/fixture/git/"))
    assert.ok(init.signal instanceof AbortSignal)
    return new Response(JSON.stringify(replies[calls.length - 1]), { status })
  }
  return { options: { repository: "owner/fixture", request }, calls }
}

test("reader pins notes commit and validates blob bytes for flat and fanout Git notes", async () => {
  for (const fanout of [false, true]) {
    const { options, calls } = reader(fixture(fanout))
    assert.deepEqual(await readGitHubCheckNote(options, revision), { notesCommit, blobSha, text })
    assert.equal(calls.length, 4)
    assert.match(calls[1], new RegExp(`/commits/${notesCommit}$`))
    assert.match(calls[3], new RegExp(`/blobs/${blobSha}$`))
    assert.equal(calls.some(url => url.includes("effect-ci-verification")), false)
  }
})

test("unknown revisions, unsafe repositories and missing/auth failures return misses", async () => {
  const { options, calls } = reader(fixture())
  assert.equal(await readGitHubCheckNote(options, "main"), undefined)
  assert.equal(await readGitHubCheckNote({ ...options, repository: "owner/fixture/../../other" }, revision), undefined)
  assert.equal(await readGitHubCheckNote({ ...options, repository: "../.." }, revision), undefined)
  assert.equal(calls.length, 0)
  for (const status of [401, 403, 404, 503]) {
    const r = reader(fixture(), status)
    assert.equal(await readGitHubCheckNote(r.options, revision), undefined)
    assert.equal(r.calls.length, 1)
  }
})

test("incomplete or ambiguous trees, mutable aliases and corrupt object identities fail closed", async () => {
  for (const mutation of [
    (r: any[]) => { r[0].ref = "refs/notes/effect-ci-verification" },
    (r: any[]) => { r[1].sha = "d".repeat(40) },
    (r: any[]) => { r[2].truncated = true },
    (r: any[]) => { r[2].tree.push({ ...r[2].tree[0], path: revision }) },
    (r: any[]) => { r[2].tree[0].mode = "120000" },
    (r: any[]) => { r[3].content = btoa(text.replace("unsigned", "tampered")) },
    (r: any[]) => { r[3].size += 1 },
    (r: any[]) => { r[3].encoding = "utf-8" },
  ]) {
    const replies = fixture(); mutation(replies)
    assert.equal(await readGitHubCheckNote(reader(replies).options, revision), undefined)
  }
})

test("bounded streaming, transport failures and redirected endpoints do not leak errors or payloads", async () => {
  const replies = fixture()
  if ("content" in replies[3]) replies[3].content = "A".repeat(70_000)
  assert.equal(await readGitHubCheckNote(reader(replies).options, revision), undefined)
  assert.equal(await readGitHubCheckNote({ repository: "owner/fixture", request: async () => { throw new Error("secret reflected by upstream") } }, revision), undefined)
  assert.equal(await readGitHubCheckNote({ repository: "owner/fixture", request: async () => {
    const response = new Response(JSON.stringify(replies[0])); Object.defineProperty(response, "url", { value: "https://evil.invalid" }); return response
  } }, revision), undefined)
})

test("deadline releases stalled transports and response streams", { timeout: 15_000 }, async () => {
  let cancelled = false
  let aborted = false
  const slowTransport = readGitHubCheckNote({ repository: "owner/fixture", request: async (_url, init) => {
    return await new Promise<Response>(resolve => {
      init.signal!.addEventListener("abort", () => { aborted = true; resolve(new Response("{}")) }, { once: true })
    })
  } }, revision)
  const slowBody = readGitHubCheckNote({ repository: "owner/fixture", request: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("{")) },
    cancel() { cancelled = true },
  })) }, revision)
  assert.deepEqual(await Promise.all([slowTransport, slowBody]), [undefined, undefined])
  assert.equal(aborted, true)
  assert.equal(cancelled, true)
})
