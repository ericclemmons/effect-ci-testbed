import { workloadIdentity, verifyAccess } from "./oidc-identity.ts"
import { allowedOwner, enableRepository, type OidcEnvironment, type RepositoryRegistry } from "./oidc-repositories.ts"

export interface RunIdentityRegistry extends RepositoryRegistry {
  recordRun(repositoryId: string, instanceId: string): Promise<void>
  ownsRun(repositoryId: string, instanceId: string): Promise<boolean>
}
export type RemoteForward = (request: Request, environment: OidcEnvironment) => Promise<Response>

const allowedRoute = (request: Request, pathname: string) =>
  request.method === "POST" && pathname === "/runs" || request.method === "GET" &&
  (pathname === "/capabilities" || /^\/runs\/[A-Za-z0-9_-]+(?:\/events)?$/.test(pathname))

/** Access is the operator identity. The internal bearer only adapts the legacy
 * worker gate and never leaves this request or reaches a project workspace. */
export const operatorRemote = async (request: Request, environment: OidcEnvironment, forward: RemoteForward,
  verify = async (req: Request) => {
    if (environment.EFFECT_CI_ACCESS_ISSUER && environment.EFFECT_CI_ACCESS_AUD) {
      try { await verifyAccess(req.headers.get("cf-access-jwt-assertion") ?? "", environment.EFFECT_CI_ACCESS_ISSUER, environment.EFFECT_CI_ACCESS_AUD); return true } catch { return false }
    }
    return false
  }): Promise<Response> => {
  const url = new URL(request.url)
  if (!allowedRoute(request, url.pathname) && !(request.method === "POST" && url.pathname === "/oidc/repositories")) return forward(request, environment)
  if (request.headers.has("authorization")) return forward(request, environment)
  const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site")
  if (origin !== null && origin !== url.origin || site !== null && !["none", "same-origin"].includes(site) ||
      request.method === "POST" && request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json" ||
      !await verify(request)) return new Response("Unauthorized", { status: 401 })
  const token = crypto.randomUUID()
  const headers = new Headers(request.headers)
  headers.set("authorization", `Bearer ${token}`)
  return forward(new Request(request, { headers }), { ...environment, EFFECT_CI_API_TOKEN: token })
}

/** Only repository-scoped machine routes bypass Access. A workload cannot read
 * another repo's run or acquire operator/approval authority. */
export const workloadRemote = async (request: Request, environment: OidcEnvironment,
  registry: RunIdentityRegistry, forward: RemoteForward): Promise<Response> => {
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api(?=\/)/, "")
  if (!allowedRoute(request, path)) return new Response("Not found", { status: 404 })
  const bearer = request.headers.get("authorization")?.match(/^Bearer (\S{1,20000})$/)?.[1]
  if (!bearer || !environment.RECEIPT_SIGNING_KEY || !environment.EFFECT_CI_PUBLIC_URL) return new Response("Unauthorized", { status: 401 })
  let claims
  try { claims = await workloadIdentity(environment.RECEIPT_SIGNING_KEY)(bearer, new URL(environment.EFFECT_CI_PUBLIC_URL).origin) }
  catch { return new Response("Unauthorized", { status: 401 }) }
  if (typeof claims.repository_id !== "string" || typeof claims.repository_owner_id !== "string" ||
      !allowedOwner(environment, claims.repository_owner_id)) return new Response("Forbidden", { status: 403 })
  if (["pull_request", "pull_request_target"].includes(String(claims.event_name))) return new Response("Forbidden", { status: 403 })
  const registered = await registry.get(claims.repository_id)
  if (!registered || registered.ownerId !== claims.repository_owner_id) return new Response("Enable this repository with cf-ci oidc", { status: 403 })
  const id = path.match(/^\/runs\/([^/]+)/)?.[1]
  if (id && !await registry.ownsRun(claims.repository_id, id)) return new Response("Forbidden", { status: 403 })
  if (request.method === "POST") {
    let input
    try {
      const body = await request.clone().text()
      if (body.length > 8192) return new Response("Request too large", { status: 413 })
      input = JSON.parse(body)
    } catch { return new Response("Invalid request", { status: 400 }) }
    const repository = `https://github.com/${registered.repository}`
    const revision = claims.sha ?? claims.revision
    if (!input || typeof input.repository !== "string" || input.repository.replace(/\.git$/, "") !== repository ||
        typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision) || input.revision !== revision ||
        input.ref !== undefined && input.ref !== claims.ref) return new Response("Workload identity does not match the requested source", { status: 403 })
  }
  url.pathname = path
  const token = crypto.randomUUID()
  const headers = new Headers(request.headers)
  headers.set("authorization", `Bearer ${token}`)
  const response = await forward(new Request(url, new Request(request, { headers })), { ...environment, EFFECT_CI_API_TOKEN: token })
  if (request.method !== "POST" || response.status !== 202) return response
  const result = await response.json() as { instanceId: string; eventsUrl: string; statusUrl: string }
  if (typeof result.instanceId !== "string" || !/^[A-Za-z0-9_-]+$/.test(result.instanceId)) throw new Error("Invalid run identity")
  await registry.recordRun(claims.repository_id, result.instanceId)
  const base = new URL(environment.EFFECT_CI_PUBLIC_URL).origin
  return Response.json({ ...result, eventsUrl: `${base}/api/runs/${result.instanceId}/events`, statusUrl: `${base}/api/runs/${result.instanceId}` }, { status: 202 })
}

/** A workload may enable only its own installed repository, never another project. */
export const enrollWorkload = async (request: Request, environment: OidcEnvironment,
  registry: RepositoryRegistry): Promise<Response> => {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S{1,20000})$/)?.[1]
  if (!token || !environment.RECEIPT_SIGNING_KEY || !environment.EFFECT_CI_PUBLIC_URL) return new Response("Unauthorized", { status: 401 })
  let claims
  try { claims = await workloadIdentity(environment.RECEIPT_SIGNING_KEY)(token, new URL(environment.EFFECT_CI_PUBLIC_URL).origin) }
  catch { return new Response("Unauthorized", { status: 401 }) }
  if (typeof claims.repository_id !== "string" || typeof claims.repository_owner_id !== "string" ||
      !allowedOwner(environment, claims.repository_owner_id) || ["pull_request", "pull_request_target"].includes(String(claims.event_name))) return new Response("Forbidden", { status: 403 })
  const internal = crypto.randomUUID()
  const headers = new Headers(request.headers)
  headers.set("authorization", `Bearer ${internal}`)
  return enableRepository(new Request(request, { headers }), { ...environment, EFFECT_CI_API_TOKEN: internal }, registry,
    undefined, identity => identity.repositoryId === claims.repository_id && identity.ownerId === claims.repository_owner_id)
}
