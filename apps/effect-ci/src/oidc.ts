import { hostedIdentity, workloadIdentity } from "./oidc-identity.ts"
import { repositoryIdentity } from "./oidc-repositories.ts"
import type { WorkflowParameters } from "../../../packages/github-cloudflare/src/worker.ts"
import { DurableObject } from "cloudflare:workers"
import { credentialBroker, type Env } from "@effect-ci-testbed/cloudflare-oidc"
import { authorize, type Policy } from "@effect-ci-testbed/cloudflare-oidc/auth"
import { allowedOwner, enableRepository, type OidcEnvironment, type RepositoryIdentity, type RepositoryRegistry } from "./oidc-repositories.ts"

export { TokenLease } from "@effect-ci-testbed/cloudflare-oidc"

export class OidcRepositories extends DurableObject {
  async get(): Promise<RepositoryIdentity | undefined> { return this.ctx.storage.get("repository") }
  async recordRun(id: string) { await this.ctx.storage.put(`run:${id}`, true) }
  async ownsRun(id: string): Promise<boolean> { return await this.ctx.storage.get(`run:${id}`) === true }
  async enable(identity: RepositoryIdentity) { await this.ctx.storage.put("repository", identity) }
}

export const repositoryRegistry = (context: ExecutionContext) => {
  const binding = (context.exports as unknown as { OidcRepositories: DurableObjectNamespace<OidcRepositories> }).OidcRepositories
  return {
    get: (id: string) => binding.getByName(id).get(),
    enable: (identity: RepositoryIdentity) => binding.getByName(identity.repositoryId).enable(identity),
    recordRun: (id: string, run: string) => binding.getByName(id).recordRun(run),
    ownsRun: (id: string, run: string) => binding.getByName(id).ownsRun(run),
  }
}

export const oidc = async (request: Request, environment: OidcEnvironment, context: ExecutionContext): Promise<Response> => {
  const registry = repositoryRegistry(context)
  const path = new URL(request.url).pathname
  if (path === "/oidc/repositories" && request.method === "POST") return enableRepository(request, environment, registry)
  if (!["/token", "/revoke"].includes(path)) return new Response("Not found", { status: 404 })
  if (!environment.EFFECT_CI_PUBLIC_URL || !environment.CLOUDFLARE_TOKEN_ISSUER || !environment.RECEIPT_SIGNING_KEY
    || !environment.CLOUDFLARE_ACCOUNT_ID || !environment.EFFECT_CI_OIDC_SCOPES) {
    return Response.json({ error: "OIDC is not configured" }, { status: 503 })
  }
  const env: Env = {
    BROKER_AUDIENCE: new URL(environment.EFFECT_CI_PUBLIC_URL).origin,
    BROKER_GRANTS: "[]",
    CLOUDFLARE_TOKEN_ISSUER: environment.CLOUDFLARE_TOKEN_ISSUER,
    RECEIPT_SIGNING_KEY: environment.RECEIPT_SIGNING_KEY,
  }
  const broker = credentialBroker(async (claims, input) => {
    if (typeof claims.repository_id !== "string" || typeof claims.repository_owner_id !== "string"
      || !allowedOwner(environment, claims.repository_owner_id)) throw new Error("Owner rejected")
    const registered = await registry.get(claims.repository_id)
    if (!registered || registered.ownerId !== claims.repository_owner_id) throw new Error("Enable this repository with effect-ci oidc")
    const scopes = JSON.parse(environment.EFFECT_CI_OIDC_SCOPES ?? "{}") as Record<string, Policy[]>
    return authorize(claims, input, [{ repositoryId: "*", repositoryOwnerId: registered.ownerId,
      ref: "*", workflowRef: "*", worker: input?.worker, accountId: environment.CLOUDFLARE_ACCOUNT_ID ?? "", scopes }])
  }, workloadIdentity(environment.RECEIPT_SIGNING_KEY))
  return broker.fetch(request, env, context)
}

// Only the trusted workflow entrypoint calls this with the source identity it
// obtained from the verified webhook or authenticated remote dispatch.
export const commandEnvironment = async (environment: OidcEnvironment, parameters: WorkflowParameters): Promise<Record<string, string>> => {
  if (!environment.RECEIPT_SIGNING_KEY || !environment.EFFECT_CI_PUBLIC_URL) return {}
  const match = parameters.repository.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/)
  if (!match) return {}
  let identity: RepositoryIdentity
  try { identity = await repositoryIdentity(match[1]!, environment) }
  catch { return {} }
  if (!allowedOwner(environment, identity.ownerId)) return {}
  const origin = new URL(environment.EFFECT_CI_PUBLIC_URL).origin
  return { EFFECT_CI_REMOTE_URL: origin, EFFECT_CI_OIDC_TOKEN: await hostedIdentity({
    repository_id: identity.repositoryId, repository_owner_id: identity.ownerId,
    ref: parameters.ref ?? "HEAD", revision: parameters.revision,
  }, origin, environment.RECEIPT_SIGNING_KEY) }
}
