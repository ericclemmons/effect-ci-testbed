/// <reference types="@cloudflare/workers-types" />

declare const __SOURCE_REVISION__: string

export default {
  async fetch(request, environment) {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 })
    const path = new URL(request.url).pathname
    const identity = {
      service: "frontend",
      revision: __SOURCE_REVISION__,
      version: environment.VERSION_METADATA.id,
    }
    const headers = { "cache-control": "no-store" }
    if (path === "/health") return Response.json(identity, { headers })
    if (path === "/api/message") {
      try {
        const response = await environment.BACKEND_API.fetch("https://backend/api/message", {
          redirect: "error", signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) throw Error("Backend unavailable")
        const backend = await response.json() as {
          service?: unknown; revision?: unknown; version?: unknown; message?: unknown
        }
        if (backend.service !== "backend" || backend.revision !== __SOURCE_REVISION__ ||
          typeof backend.version !== "string" || backend.message !== "Hello from the backend API")
          throw Error("Backend identity mismatch")
        return Response.json({ ...identity, backend }, { headers })
      } catch {
        return Response.json({ ...identity, error: "Backend unavailable or revision mismatch" }, { status: 502, headers })
      }
    }
    if (path !== "/") return new Response("Not found", { status: 404 })
    return new Response(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Ordered deployment</title><main><h1>Frontend → backend API</h1>
<p id="message" role="status">Loading the backend message…</p></main>
<script type="module">
const message = document.querySelector("#message");
try {
  const response = await fetch("/api/message", { cache: "no-store" });
  if (!response.ok) throw Error("Backend unavailable");
  const result = await response.json();
  message.textContent = result.backend.message;
} catch {
  message.textContent = "The backend API is unavailable.";
}
</script></html>`, { headers: { ...headers, "content-type": "text/html; charset=utf-8" } })
  },
} satisfies ExportedHandler<{ VERSION_METADATA: WorkerVersionMetadata; BACKEND_API: Fetcher }>
