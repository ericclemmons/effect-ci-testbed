import { verifyAccess } from "./oidc-identity.ts"
import { createAppJwt, createInstallationToken } from "../../../packages/github/src/app.ts"

export interface RepositoryIdentity {
  repository: string
  repositoryId: string
  ownerId: string
}

export interface OidcEnvironment {
  EFFECT_CI_PUBLIC_URL?: string
  EFFECT_CI_ACCESS_ISSUER?: string
  EFFECT_CI_ACCESS_AUD?: string
  EFFECT_CI_API_TOKEN?: string
  EFFECT_CI_OIDC_OWNER_IDS?: string
  EFFECT_CI_OIDC_SCOPES?: string
  CLOUDFLARE_ACCOUNT_ID?: string
  CLOUDFLARE_TOKEN_ISSUER?: string
  RECEIPT_SIGNING_KEY?: string
  GITHUB_APP_ID: string
  GITHUB_PRIVATE_KEY: string
}

export interface RepositoryRegistry {
  get(repositoryId: string): Promise<RepositoryIdentity | undefined>
  enable(identity: RepositoryIdentity): Promise<void>
}

export const allowedOwner = (environment: OidcEnvironment, ownerId: string): boolean =>
  /^\d+$/.test(ownerId) && (environment.EFFECT_CI_OIDC_OWNER_IDS ?? "")
    .split(",").map((id) => id.trim()).includes(ownerId)

export const repositoryIdentity = async (
  repository: string,
  environment: OidcEnvironment,
  fetcher: typeof fetch = fetch,
): Promise<RepositoryIdentity> => {
  const credentials = { appId: environment.GITHUB_APP_ID, privateKey: environment.GITHUB_PRIVATE_KEY }
  const headers = (token: string) => ({ authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "effect-ci" })
  const installation = await fetcher(`https://api.github.com/repos/${repository}/installation`, {
    headers: headers(await createAppJwt(credentials)), redirect: "manual", signal: AbortSignal.timeout(15_000),
  })
  if (!installation.ok) throw new Error("Install the hosted CI GitHub App on this repository first")
  const { id } = await installation.json() as { id: number }
  const token = await createInstallationToken(credentials, id, repository.split("/")[1])
  const response = await fetcher(`https://api.github.com/repos/${repository}`, {
    headers: headers(token), redirect: "manual", signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error("Could not verify repository identity with GitHub")
  const value = await response.json() as { id: number; full_name: string; owner: { id: number } }
  if (!Number.isSafeInteger(value.id) || !Number.isSafeInteger(value.owner?.id)
    || value.full_name.toLowerCase() !== repository.toLowerCase()) throw new Error("Invalid GitHub repository identity")
  return { repository: value.full_name, repositoryId: String(value.id), ownerId: String(value.owner.id) }
}

export const enableRepository = async (
  request: Request,
  environment: OidcEnvironment,
  registry: RepositoryRegistry,
  identify = repositoryIdentity,
  identityAllowed: (identity: RepositoryIdentity) => boolean = () => true,
): Promise<Response> => {
  // Prefer a verified Access identity; retain the existing API-token path for
  // CLI service credentials. An arbitrary Access header is never sufficient.
  let authorized = !!environment.EFFECT_CI_API_TOKEN && request.headers.get("authorization") === `Bearer ${environment.EFFECT_CI_API_TOKEN}`
  if (!authorized && environment.EFFECT_CI_ACCESS_ISSUER && environment.EFFECT_CI_ACCESS_AUD) {
    try {
      await verifyAccess(request.headers.get("cf-access-jwt-assertion") ?? "", environment.EFFECT_CI_ACCESS_ISSUER, environment.EFFECT_CI_ACCESS_AUD)
      authorized = true
    } catch { /* Invalid or absent Access identity. */ }
  }
  if (!authorized) return Response.json({ error: "Authenticate through Cloudflare Access" }, { status: 401 })
  if (!environment.EFFECT_CI_PUBLIC_URL || !environment.RECEIPT_SIGNING_KEY || !environment.EFFECT_CI_OIDC_OWNER_IDS) {
    return Response.json({ error: "The hosted CI operator has not configured OIDC identity" }, { status: 503 })
  }
  let input: { repository?: unknown }
  try {
    const text = await request.text()
    if (text.length > 4096) return Response.json({ error: "Request too large" }, { status: 413 })
    input = JSON.parse(text)
  } catch { return Response.json({ error: "Expected a GitHub repository" }, { status: 400 }) }
  if (!input || typeof input.repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)) {
    return Response.json({ error: "Expected repository as OWNER/REPO" }, { status: 400 })
  }
  try {
    const identity = await identify(input.repository, environment)
    if (!allowedOwner(environment, identity.ownerId) || !identityAllowed(identity)) return Response.json({ error: "Repository owner is not allowed" }, { status: 403 })
    await registry.enable(identity)
    return Response.json({ ...identity, issuer: new URL(environment.EFFECT_CI_PUBLIC_URL).origin, enabled: true })
  } catch {
    return Response.json({ error: "Could not verify repository; check the GitHub App installation" }, { status: 502 })
  }
}
