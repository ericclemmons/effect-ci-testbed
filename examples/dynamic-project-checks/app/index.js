import { greeting } from "./lib.js"

export default {
  async fetch(request, env) {
    switch (new URL(request.url).pathname) {
      case "/greeting": return new Response(greeting("world"))
      case "/bindings": return new Response(JSON.stringify(Object.keys(env)))
      case "/network":
        try {
          await fetch("https://example.com")
          return new Response("escaped")
        } catch { return new Response("blocked") }
      default: return new Response("not found", { status: 404 })
    }
  },
}
