/// <reference types="@cloudflare/workers-types" />

declare const __SOURCE_REVISION__: string

export default {
  fetch(request, environment) {
    const path = new URL(request.url).pathname
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 })
    if (path !== "/health" && path !== "/api/message") return new Response("Not found", { status: 404 })
    return Response.json({
      service: "backend",
      revision: __SOURCE_REVISION__,
      version: environment.VERSION_METADATA.id,
      message: "Hello from the backend API",
    }, { headers: { "cache-control": "no-store" } })
  },
} satisfies ExportedHandler<{ VERSION_METADATA: WorkerVersionMetadata }>
