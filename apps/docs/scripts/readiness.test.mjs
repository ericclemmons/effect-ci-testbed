import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.resolve("cf/package.json"))
const { Miniflare } = require("miniflare")

test("the docs API shares complete checks and keeps them when GitHub returns 403", { timeout: 30_000 }, async () => {
  const sha = "a".repeat(40)
  let calls = 0
  let blocked = false
  const runtime = new Miniflare({ workers: [{ config: {
    name: "docs-readiness", compatibilityDate: "2026-10-07",
    manifest: { mainModule: "driver.mjs", modules: {
      "worker.mjs": { type: "esm", contents: await readFile(new URL("../src/worker.mjs", import.meta.url), "utf8") },
      "driver.mjs": { type: "esm", contents: `
        import worker from "./worker.mjs";
        const now = Date.now;
        export default {fetch(request) {
          Date.now = () => now() + Number(request.headers.get("x-test-age") || 0);
          return worker.fetch(request, {ASSETS: {fetch: () => new Response("static guide")}});
        }};
      ` },
    } },
  }, dev: { outboundService: { type: "fetcher", handler: async request => {
    calls++
    if (blocked) return Response.json({ message: "API rate limit exceeded" }, { status: 403 })
    const url = new URL(request.url)
    assert.equal(url.hostname, "api.github.com")
    if (url.pathname.endsWith("/commits/main")) return Response.json({ sha })
    assert.ok(url.pathname.endsWith(`/commits/${sha}/check-runs`))
    const id = Number(url.searchParams.get("page"))
    return Response.json({ total_count: 2, check_runs: [{
      id, name: `Check ${id}`, head_sha: sha, status: "completed", conclusion: "success", app: { slug: "github-actions" },
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
    assert.equal(calls, 3, "simultaneous visitors share the commit and both check pages")
    blocked = true
    assert.equal((await request("/api/readiness?refresh=1")).status, 200)
    assert.equal(calls, 3, "query strings cannot bypass the shared cache")
    const fallback = await request("/api/readiness", 660_000)
    assert.equal(fallback.status, 200)
    const data = await fallback.json()
    assert.equal(data.sha, sha)
    assert.equal(data.check_runs.length, 2)
    assert.equal(data.stale, true, "GitHub's 403 keeps timestamped evidence visible")
    await request("/api/readiness", 660_000)
    assert.equal(calls, 4, "failed refreshes back off instead of consuming more quota")
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
