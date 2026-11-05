/// <reference types="@cloudflare/workers-types" />

export default {
  fetch(request) {
    const { pathname } = new URL(request.url)

    return pathname === "/health"
      ? Response.json({ ok: true })
      : new Response("Hello from Cloudflare Workers")
  },
} satisfies ExportedHandler
