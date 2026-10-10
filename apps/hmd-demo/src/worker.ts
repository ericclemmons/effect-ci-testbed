interface Env { WORKER_METADATA: WorkerVersionMetadata; FAILURE_RATE: string }

/** Dedicated public test target: no credentials, source, administrative routes, or production traffic. */
export default {
  fetch(request: Request, env: Env): Response {
    if (new URL(request.url).pathname !== "/health") return new Response("Not found", { status: 404 })
    const rate = Number(env.FAILURE_RATE)
    if (!Number.isFinite(rate) || rate < 0 || rate > 1 || !env.WORKER_METADATA.id) return new Response("Invalid demo configuration", { status: 503 })
    const failed = Math.random() < rate
    console.log(JSON.stringify({ hmd: { versionId: env.WORKER_METADATA.id,
      invocation: "fetch", outcome: failed ? "application-error" : "ok" } }))
    return Response.json({ version: env.WORKER_METADATA.id, healthy: !failed },
      { status: failed ? 503 : 200, headers: { "cache-control": "no-store" } })
  },
} satisfies ExportedHandler<Env>
