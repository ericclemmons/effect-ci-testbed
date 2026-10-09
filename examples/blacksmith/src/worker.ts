export default {
  fetch(request: Request): Response {
    return new URL(request.url).pathname === "/health"
      ? Response.json({ healthy: true })
      : new Response("Not found", { status: 404 })
  },
}
