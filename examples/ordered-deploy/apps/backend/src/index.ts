/// <reference types="@cloudflare/workers-types" />

export default {
  fetch() {
    return Response.json({ service: "backend" })
  },
} satisfies ExportedHandler
