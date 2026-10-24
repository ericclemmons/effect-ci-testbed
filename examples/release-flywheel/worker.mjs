/** Dedicated release proof: the uploaded module is exactly this tested file. */
export default {
  fetch(request, env) {
    if (new URL(request.url).pathname !== "/health") return new Response("Not found", { status: 404 })
    if (!env.WORKER_METADATA?.id) return new Response("Missing version identity", { status: 503 })
    return Response.json({ version: env.WORKER_METADATA.id, healthy: true },
      { headers: { "cache-control": "no-store" } })
  },
}
