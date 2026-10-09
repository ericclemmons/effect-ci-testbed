import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import { readSourceManifest } from "./source-manifest.ts"

const revision = "a".repeat(40)
const repository = "https://github.com/ericclemmons/effect-ci-testbed.git"

test("hosted inference pins discovery to the requested source and shares the CLI graph", async () => {
  const manifest = await readSourceManifest({ repository, revision }, "examples/zero-config", async (url, options) => {
    assert.equal(url, `https://raw.githubusercontent.com/ericclemmons/effect-ci-testbed/${revision}/examples/zero-config/package.json`)
    assert.equal(options?.redirect, "manual")
    return Response.json({ name: "fixture", scripts: { lint: "node --check src.js", build: "node build.js", deploy: "not-inferred" } })
  })
  const inferred = CI.fromPackageJson(manifest)
  assert.deepEqual(Object.keys(inferred.actions), ["lint", "build"])
  const result = await CI.runPromise(inferred.workflow, { mode: "plan", output: "silent" })
  assert.deepEqual(result.plan.nodes.map((node) => node.id), ["checkout", "install", "lint", "build"])
  assert.ok(result.plan.nodes.find((node) => node.id === "build")?.dependencies.includes("lint"))
})

test("hosted manifest discovery rejects mutable revisions and unsafe sources before fetching", async () => {
  const neverFetch: typeof fetch = async () => { throw new Error("must not fetch") }
  for (const source of [
    { repository, revision: "main" },
    { repository: "https://example.com/owner/repo", revision },
    { repository: "https://user:secret@github.com/owner/repo", revision },
  ]) {
    await assert.rejects(readSourceManifest(source, "examples/zero-config", neverFetch), /Hosted discovery requires/)
  }
  await assert.rejects(readSourceManifest({ repository, revision }, "../outside", neverFetch), /Hosted discovery requires/)
})

test("invalid manifests and missing conventional tasks fail explicitly", async () => {
  await assert.rejects(readSourceManifest({ repository, revision }, "examples/zero-config", async () =>
    Response.json({ scripts: { lint: false } })), /Invalid package scripts/)
  assert.throws(() => CI.fromPackageJson({ scripts: { deploy: "deploy" } }), /no format, lint/)
})

test("Workers-compatible fetch rejects redirects without following them", async () => {
  let calls = 0
  await assert.rejects(readSourceManifest({ repository, revision }, "examples/zero-config", async (_url, options) => {
    calls++
    if (options?.redirect === "error") throw new TypeError("Invalid redirect value")
    assert.equal(options?.redirect, "manual")
    return new Response(null, { status: 302, headers: { location: "https://example.com" } })
  }), /Source manifest fetch failed: 302/)
  assert.equal(calls, 1)
})
