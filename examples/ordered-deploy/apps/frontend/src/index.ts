/// <reference types="@cloudflare/workers-types" />

export default {
  fetch() {
    return new Response("frontend")
  },
} satisfies ExportedHandler
