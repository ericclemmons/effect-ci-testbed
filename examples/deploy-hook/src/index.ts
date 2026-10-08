/// <reference types="@cloudflare/workers-types" />

export default {
  fetch() {
    return new Response("deployed from a hook")
  },
} satisfies ExportedHandler
