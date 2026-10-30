let pending

async function read(path) {
  const response = await fetch(`https://api.github.com/repos/ericclemmons/effect-ci-testbed/${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "effect-ci-docs" },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`)
  return response.json()
}

async function snapshot() {
  const { sha } = await read("commits/main")
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("GitHub did not return a commit")
  const checks = new Map()
  let count = 0
  for (let page = 1; ; page++) {
    const { check_runs, total_count } = await read(`commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`)
    if (!Array.isArray(check_runs) || !Number.isInteger(total_count)) throw new Error("Invalid check response")
    for (const check of check_runs) {
      if (check.head_sha !== sha) continue
      const key = `${check.app.slug}:${check.name}`
      if (check.id > (checks.get(key)?.id ?? 0)) {
        const { id, name, head_sha, status, conclusion, app: { slug } } = check
        checks.set(key, { id, name, head_sha, status, conclusion, app: { slug } })
      }
    }
    count += check_runs.length
    if (count >= total_count) break
    if (!check_runs.length || page >= 50) throw new Error("Incomplete check response")
  }
  return { sha, check_runs: [...checks.values()], total_count: count, fetchedAt: new Date().toISOString() }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/api/readiness") return env.ASSETS.fetch(request)
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } })

    // Ignore query strings so visitors share one cache entry at each location.
    const key = new Request(new URL("/api/readiness", request.url))
    const cache = caches.default
    const cached = await cache.match(key)
    const saved = cached ? await cached.json() : undefined
    let data = saved?.sha ? saved : undefined
    const age = data ? Date.now() - Date.parse(data.fetchedAt) : Infinity
    if (age > 86_400_000) data = undefined
    let error
    if (age >= 600_000 && Date.now() >= (saved?.retryAt ?? 0)) {
      try {
        // Coalesce simultaneous misses within an isolate. Only complete reads replace the cache.
        pending ??= snapshot().then(async result => {
          await cache.put(key, Response.json(result, { headers: { "Cache-Control": "public, max-age=86400" } })).catch(() => {})
          return result
        }).finally(() => { pending = undefined })
        data = await pending
      } catch {
        error = "GitHub checks could not be refreshed"
        const fallback = { ...data, retryAt: Date.now() + 600_000 }
        await cache.put(key, Response.json(fallback, { headers: { "Cache-Control": "public, max-age=86400" } })).catch(() => {})
      }
    }
    if (!data) return Response.json({ error: error ?? "GitHub checks unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "600" },
    })
    return Response.json({ ...data, stale: Date.now() - Date.parse(data.fetchedAt) >= 600_000 }, {
      headers: { "Cache-Control": "public, max-age=60" },
    })
  },
}
