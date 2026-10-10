import { test } from "node:test"
import assert from "node:assert/strict"
import { readArtifactSource } from "./artifacts-source.ts"

const revision = "a".repeat(40)
const entry = (name: string, type: ArtifactsTreeEntryType = "blob"): ArtifactsTreeEntry => ({ name, type, hash: name, mode: "100644" })
const repo = (children: ArtifactsTreeEntry[], data = new Uint8Array([0, 255, 10])) => ({
  readCommit: async () => ({ hash: revision, treeHash: "root" }) as ArtifactsCommitMetadata,
  readTree: async (hash: string) => hash === "root" ? [entry("app", "tree")] : children,
  readBlob: async () => new Blob([data]),
})

test("Artifacts exports binary and executable files at an immutable revision", async () => {
  const files = await readArtifactSource(repo([entry("binary"), entry("script", "exec")]), revision, "app")
  assert.deepEqual(files, [
    { path: "binary", base64: "AP8K", executable: false },
    { path: "script", base64: "AP8K", executable: true },
  ])
})

test("Artifacts rejects mutable refs, traversal, links and duplicate entries", async () => {
  await assert.rejects(readArtifactSource(repo([]), "main", "app"), /immutable/)
  await assert.rejects(readArtifactSource(repo([]), revision, "../app"), /directory/)
  for (const children of [[entry("../escape")], [entry("link", "symlink")], [entry("module", "gitlink")], [entry("same"), entry("same")]]) {
    await assert.rejects(readArtifactSource(repo(children), revision, "app"))
  }
})

test("Artifacts fails closed on missing objects and oversized exports", async () => {
  await assert.rejects(readArtifactSource({ ...repo([]), readCommit: async () => null }, revision, "app"), /commit/)
  await assert.rejects(readArtifactSource({ ...repo([entry("missing")]), readBlob: async () => null }, revision, "app"), /blob/)
  await assert.rejects(readArtifactSource(repo([entry("big")], new Uint8Array(65537)), revision, "app"), /byte limit/)
  await assert.rejects(readArtifactSource(repo(Array.from({ length: 1001 }, (_, i) => entry(String(i)))), revision, "app"), /entry limit/)
  await assert.rejects(readArtifactSource(repo(Array.from({ length: 500 }, (_, i) => entry(`${i}-${"x".repeat(240)}`)), new Uint8Array()), revision, "app"), /manifest limit/)
})
