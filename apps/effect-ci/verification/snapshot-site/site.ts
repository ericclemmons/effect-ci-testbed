import { DurableObject } from "cloudflare:workers"
import type { DeploymentVerification } from "@effect-ci-testbed/cloudflare/snapshot-deployment"

const csp = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
export const servingPolicy = JSON.stringify({ version: 1, type: "text/html; charset=utf-8", csp, cache: "no-store" })
export const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), b => b.toString(16).padStart(2, "0")).join("")
interface Published { receipt: string; body: string; digest: string; configuration: string }

/** One small HTML destination. Publication is idempotent per producing run;
 * replaying old history never moves the current deployment backwards. */
export class Site extends DurableObject {
  async publish(owner: string, body: string): Promise<string> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner) || typeof body !== "string") throw Error("Invalid site publication")
    const bytes = new TextEncoder().encode(body)
    if (!bytes.length || bytes.length > 64 * 1024) throw Error("HTML output limit exceeded")
    const digest = await sha256(bytes)
    return this.ctx.storage.transaction(async tx => {
      const old = await tx.get<Published>(`publication:${owner}`)
      if (old) {
        if (old.digest !== digest || old.configuration !== servingPolicy) throw Error("Immutable site publication conflict")
        return old.receipt
      }
      const publication: Published = { receipt: crypto.randomUUID(), body, digest, configuration: servingPolicy }
      await tx.put(`publication:${owner}`, publication)
      await tx.put("current", publication)
      return publication.receipt
    })
  }

  async verifyCurrent(request: DeploymentVerification): Promise<boolean> {
    if (request.configuration !== servingPolicy || request.manifest.files.length !== 1) return false
    const file = request.manifest.files[0]!
    if (file.path !== "dist/index.html" || file.executable) return false
    const response = await this.fetch(new Request("https://snapshot-site.invalid/index.html"))
    if (response.status !== 200 || response.headers.get("x-deployment-id") !== request.receipt ||
      response.headers.get("content-security-policy") !== csp || response.headers.get("content-type") !== "text/html; charset=utf-8") return false
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length !== file.size || await sha256(bytes) !== file.sha256) return false
    return (await this.ctx.storage.get<Published>("current"))?.receipt === request.receipt
  }

  async fetch(request: Request): Promise<Response> {
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 })
    if (!["/", "/index.html"].includes(new URL(request.url).pathname)) return new Response("Not found", { status: 404 })
    const current = await this.ctx.storage.get<Published>("current")
    if (!current || current.configuration !== servingPolicy) return new Response("Not deployed", { status: 404 })
    return new Response(request.method === "HEAD" ? null : current.body, { headers: {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
      "content-security-policy": csp, "x-content-type-options": "nosniff", "x-deployment-id": current.receipt,
    } })
  }
}
