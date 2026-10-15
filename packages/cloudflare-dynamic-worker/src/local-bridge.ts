// TRUSTED engine bridge only. Project source enters as JSON data, never as host imports.
import { runProjectChecks } from "./project-checks.ts"
const ready = { mainModule: "ready.js", modules: { "ready.js": "export default {fetch(){return new Response('ready')}}" },
  checks: [{ name: "runtime capability", path: "/", status: 200, body: "ready" }] }
export default { async fetch(request: Request, env: { LOADER: WorkerLoader }) {
  if (request.method === "GET" && new URL(request.url).pathname === "/ready") {
    try { await runProjectChecks(env.LOADER, ready); return new Response("ready") }
    catch { return new Response("Isolate unavailable", { status: 503 }) }
  }
  if (request.method !== "POST" || new URL(request.url).pathname !== "/check") return new Response("Not found", { status: 404 })
  try { return Response.json(await runProjectChecks(env.LOADER, await request.json())) }
  catch (error) {
    const message = error instanceof Error && /^Project check failed: [a-zA-Z0-9 -]{1,64}$/.test(error.message)
      ? error.message : "Isolated project assertions failed"
    return Response.json({ error: message }, { status: 422 })
  }
} }
