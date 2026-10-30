import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { generateKeyPairSync } from "node:crypto"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.resolve("cf/package.json"))
const { Miniflare } = require("miniflare")
const pluginRequire = createRequire(import.meta.resolve("../../effect-ci/node_modules/@cloudflare/vite-plugin/package.json"))
const { build } = pluginRequire("esbuild")

test("the docs API shares complete checks and keeps them when GitHub returns 403", { timeout: 30_000 }, async () => {
  const sha = "a".repeat(40)
  let calls = 0
  let blocked = false
  let status = "completed"
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } })
  const bundled = await build({ entryPoints: [new URL("../../effect-ci/src/docs-readiness.ts", import.meta.url).pathname],
    bundle: true, write: false, format: "esm", platform: "neutral", external: ["cloudflare:workers"] })
  const [broker] = bundled.outputFiles
  const runtime = new Miniflare({ workers: [{ config: {
    name: "docs-readiness", compatibilityDate: "2026-10-07",
    manifest: { mainModule: "driver.mjs", modules: {
      "worker.mjs": { type: "esm", contents: await readFile(new URL("../src/worker.mjs", import.meta.url), "utf8") },
      "driver.mjs": { type: "esm", contents: `
        import worker from "./worker.mjs";
        const now = Date.now;
        export default {async fetch(request, env) {
          Date.now = () => now() + Number(request.headers.get("x-test-age") || 0);
          return worker.fetch(request, {GITHUB_READINESS: env.GITHUB_READINESS, ASSETS: {fetch: () => new Response("static guide")}});
        }};
      ` },
    } },
    env: { GITHUB_READINESS: { type: "worker", worker: "docs-reader", exportName: "DocsReadiness" } },
  } }, { config: {
    name: "docs-reader", compatibilityDate: "2026-10-07",
    manifest: { mainModule: "reader.mjs", modules: { "reader.mjs": { type: "esm", contents: broker.text } } },
    exports: { DocsReadiness: { type: "worker" } },
    env: { GITHUB_APP_ID: { type: "text", value: "5089816" }, GITHUB_PRIVATE_KEY: { type: "text", value: privateKey } },
  }, dev: { outboundService: { type: "fetcher", handler: async request => {
    calls++
    const url = new URL(request.url)
    assert.equal(url.hostname, "api.github.com")
    if (url.pathname.endsWith("/access_tokens")) {
      assert.deepEqual(await request.json(), { repositories: ["effect-ci-testbed"], permissions: { contents: "read", checks: "read" } })
      return Response.json({ token: "test-only-token", permissions: { contents: "read", checks: "read" } })
    }
    assert.equal(request.headers.get("authorization"), "Bearer test-only-token")
    if (url.pathname === "/installation/token") {
      assert.equal(request.method, "DELETE")
      return new Response(null, { status: 204 })
    }
    if (blocked) return Response.json({ message: "API rate limit exceeded" }, { status: 403 })
    if (url.pathname.endsWith("/commits/main")) return Response.json({ sha })
    assert.ok(url.pathname.endsWith(`/commits/${sha}/check-runs`))
    const id = Number(url.searchParams.get("page"))
    return Response.json({ total_count: 2, check_runs: [{
      id, name: `Check ${id}`, head_sha: sha, status, conclusion: status === "completed" ? "success" : null, app: { slug: "github-actions" },
    }] })
  } } } }] })
  const request = (path = "/api/readiness", age = 0, host = "docs.invalid") => runtime.dispatchFetch(`https://${host}${path}`, {
    headers: { "x-test-age": String(age) },
  })
  try {
    const responses = await Promise.all([request(), request()])
    for (const response of responses) {
      assert.equal(response.status, 200)
      const data = await response.json()
      assert.equal(data.sha, sha)
      assert.equal(data.check_runs.length, 2)
      assert.equal(data.stale, false)
    }
    assert.equal(calls, 5, "simultaneous visitors share one scoped token and the complete snapshot")
    status = "in_progress"
    const active = await request("/api/readiness", 0, "active.invalid")
    assert.equal(active.headers.get("cache-control"), "no-store")
    assert.equal((await active.json()).active, true)
    const activeCalls = calls
    await request("/api/readiness", 10_000, "active.invalid")
    assert.equal(calls, activeCalls, "active visitors still share a short refresh window")
    status = "completed"
    const finished = await request("/api/readiness", 31_000, "active.invalid")
    assert.equal((await finished.json()).active, false, "running checks can finish after 30 seconds, without waiting ten minutes")
    assert.equal(calls, activeCalls + 5)
    await request("/api/readiness", 61_000, "active.invalid")
    assert.equal(calls, activeCalls + 5, "finished snapshots retain the longer cache window")
    const beforeFailure = calls
    blocked = true
    assert.equal((await request("/api/readiness?refresh=1")).status, 200)
    assert.equal(calls, beforeFailure, "query strings cannot bypass the shared cache")
    const fallback = await request("/api/readiness", 660_000)
    assert.equal(fallback.status, 200)
    const data = await fallback.json()
    assert.equal(data.sha, sha)
    assert.equal(data.check_runs.length, 2)
    assert.equal(data.stale, true, "GitHub's 403 keeps timestamped evidence visible")
    await request("/api/readiness", 660_000)
    assert.equal(calls, beforeFailure + 3, "failed refreshes back off instead of consuming more quota")
    const expired = await request("/api/readiness", 86_500_000)
    assert.equal(expired.status, 503, "evidence older than one day is not served")
    const cold = await request("/api/readiness", 0, "cold.invalid")
    assert.equal(cold.status, 503)
    const failedCalls = calls
    await request("/api/readiness", 0, "cold.invalid")
    assert.equal(calls, failedCalls, "cold failures also back off")
    assert.equal(await (await request("/walkthrough/")).text(), "static guide")
  } finally { await runtime.dispose() }
})
