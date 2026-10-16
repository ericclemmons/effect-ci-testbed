import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { readStaticAssetsGitHub, readStaticBuildAssetsGitHub } from "./static-assets-github.ts"
const revision = "a".repeat(40), treeSha = "b".repeat(40)
const prefix = "https://api.github.com/repos/ericclemmons/effect-ci-testbed/git/"
function fixture(change: (path: string, value: any) => any = (_, value) => value) {
  const blobSha = createHash("sha1").update("blob 5\0hello").digest("hex"), calls: string[] = []
  const transport: typeof fetch = async (input, init) => {
    const url = String(input); calls.push(url)
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "manual"); assert.ok(url.startsWith(prefix))
    const path = url.slice(prefix.length)
    const value = path === `commits/${revision}` ? { sha: revision, tree: { sha: treeSha } } : path.startsWith("trees/") ?
      { sha: treeSha, truncated: false, tree: ["app.js", "index.html", "style.css"].map(name => ({ path: `examples/static-assets-source/site/${name}`, type: "blob", mode: "100644", size: 5, sha: blobSha })) } :
      { sha: blobSha, size: 5, encoding: "base64", content: "aGVsbG8=\n" }
    return Response.json(change(path, value))
  }
  return { transport, calls }
}
test("reads only immutable fixed-repository objects and verifies Git blob bytes", async () => {
  const f = fixture(), result = await readStaticAssetsGitHub(revision, f.transport)
  assert.equal(f.calls.length, 5); assert.equal(result.revision, revision)
  assert.equal(JSON.parse(new TextDecoder().decode(result.bytes)).files.length, 3)
})
test("invalid revision makes no requests; truncated trees, symlinks and forged bytes reject", async () => {
  const f = fixture(); await assert.rejects(readStaticAssetsGitHub("main", f.transport)); assert.equal(f.calls.length, 0)
  for (const change of [
    (path: string, value: any) => path.startsWith("trees/") ? { ...value, truncated: true } : value,
    (path: string, value: any) => path.startsWith("trees/") ? { ...value, tree: value.tree.map((entry: any) => ({ ...entry, mode: "120000" })) } : value,
    (path: string, value: any) => path.startsWith("blobs/") ? { ...value, content: "d29ybGQ=" } : value,
    (path: string, value: any) => path.startsWith("commits/") ? { ...value, sha: "c".repeat(40) } : value,
  ]) await assert.rejects(readStaticAssetsGitHub(revision, fixture(change).transport))
})
test("redirects and oversized response streams fail closed without following", async () => {
  await assert.rejects(readStaticAssetsGitHub(revision, async () => new Response(null, { status: 302, headers: { location: "https://foreign.invalid" } })))
  await assert.rejects(readStaticAssetsGitHub(revision, async () => new Response("x".repeat(128 * 1024 + 1))))
})
test("build reader has its own closed fixture and emits authenticated raw TypeScript, not generated JavaScript", async () => {
  const f = fixture((path, value) => path.startsWith("trees/") ? { ...value, tree: value.tree.map((e: any) =>
    ({ ...e, path: e.path.replace("/site/", "/build-site/").replace("/app.js", "/app.ts") })) } : value)
  const source = await readStaticBuildAssetsGitHub(revision, f.transport)
  assert.equal(f.calls.length, 5)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(source.bytes)).files.map((f: any) => f.path),
    ["site/app.ts", "site/index.html", "site/style.css"])
  await assert.rejects(readStaticBuildAssetsGitHub(revision, fixture().transport), /file identity mismatch/)
})
