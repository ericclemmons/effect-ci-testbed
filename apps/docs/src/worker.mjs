let pending

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/api/readiness") return env.ASSETS.fetch(request)
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } })

    // Ignore query strings so visitors share one cache entry at each location.
    const key = new Request(new URL("/api/readiness/v2", request.url))
    const cache = caches.default
    const cached = await cache.match(key)
    const saved = cached ? await cached.json() : undefined
    let data = saved?.sha ? saved : undefined
    const age = data ? Date.now() - Date.parse(data.fetchedAt) : Infinity
    if (age > 86_400_000) data = undefined
    let error
    if (age >= (data?.active ? 30_000 : 600_000) && Date.now() >= (saved?.retryAt ?? 0)) {
      try {
        // Coalesce simultaneous misses within an isolate. Only complete reads replace the cache.
        pending ??= env.GITHUB_READINESS.read().then(async result => {
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
    return Response.json({ ...data, stale: Date.now() - Date.parse(data.fetchedAt) >= (data.active ? 30_000 : 600_000) }, {
      headers: { "Cache-Control": data.active ? "no-store" : "public, max-age=60" },
    })
  },
}
