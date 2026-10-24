import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from "jose";

export const issuer = "https://token.actions.githubusercontent.com";
const githubKeys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));
export type Policy = {
  effect: "allow";
  permission_groups: Array<{ id: string }>;
  resources: Record<string, string | Record<string, string>>;
};
export interface Grant {
  repositoryId: string;
  repositoryOwnerId: string;
  ref: string;
  workflowRef: string;
  accountId: string;
  worker: string;
  scopes: Record<string, Policy[]>;
}
export interface ScopeRequest { worker: string; scopes: string[] }

function matchesRepository(claims: JWTPayload, grant: Grant) {
  if (grant.repositoryOwnerId !== claims.repository_owner_id) return false;
  if (grant.repositoryId !== "*") {
    return grant.repositoryId === claims.repository_id && grant.workflowRef === claims.workflow_ref;
  }
  // Only the repository segment may vary; the immutable owner ID stays explicit.
  if (!/^\d+$/.test(grant.repositoryOwnerId) || typeof claims.repository_id !== "string"
    || !/^\d+$/.test(claims.repository_id) || typeof claims.workflow_ref !== "string") return false;
  const [owner, repository, ...workflow] = grant.workflowRef.split("/");
  const [actualOwner, actualRepository, ...actualWorkflow] = claims.workflow_ref.split("/");
  return repository === "*" && !!owner && !owner.includes("*")
    && !!actualRepository && actualRepository !== "*" && actualOwner === owner
    && workflow.length > 0 && !workflow.join("/").includes("*")
    && workflow.join("/") === actualWorkflow.join("/");
}

export async function verifyIdentity(token: string, audience: string, keys: JWTVerifyGetKey = githubKeys) {
  const { payload } = await jwtVerify(token, keys, {
    issuer, audience, algorithms: ["RS256"], maxTokenAge: "10m",
    requiredClaims: ["exp", "iat", "nbf", "jti", "sub", "repository_id", "repository_owner_id", "ref", "workflow_ref", "run_id", "run_attempt"],
  });
  return payload;
}

export function authorize(claims: JWTPayload, request: ScopeRequest, grants: Grant[]) {
  if (!request || typeof request.worker !== "string" || !Array.isArray(request.scopes)
    || request.scopes.length === 0 || request.scopes.length > 8
    || request.scopes.some((scope) => typeof scope !== "string")) throw new Error("Scope request rejected");
  // Deliberately no PR or pull_request_target authority in this first prototype.
  if (!["push", "workflow_dispatch"].includes(String(claims.event_name))) throw new Error("Event rejected");
  const grant = grants.find((entry) => entry.worker === request.worker
    && matchesRepository(claims, entry) && entry.ref === claims.ref);
  if (!grant || !/^[a-f0-9]{32}$/.test(grant.accountId)) throw new Error("Identity rejected");
  const policies = [...new Set(request.scopes)].flatMap((scope) => {
    if (!Object.hasOwn(grant.scopes, scope) || !grant.scopes[scope]?.length) throw new Error("Scope rejected");
    return grant.scopes[scope]!;
  });
  return { accountId: grant.accountId, policies };
}

export async function cloudflareTokenRequest(accountId: string, issuerToken: string, method: "POST" | "DELETE", bodyOrId: unknown, fetcher = fetch) {
  const suffix = method === "DELETE" ? `/${encodeURIComponent(String(bodyOrId))}` : "";
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens${suffix}`, {
    // Workers supports manual redirects, not redirect: "error". Non-2xx replies fail below.
    method, redirect: "manual", signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${issuerToken}`, "content-type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(bodyOrId) } : {}),
  });
  // Never propagate upstream response bodies: creation responses contain credentials.
  if (!response.ok) throw new Error(`Cloudflare token operation failed (${response.status})`);
  const value = await response.json() as { success?: boolean; result?: { id?: string; value?: string } };
  if (value.success !== true) throw new Error("Cloudflare token operation failed");
  return value.result;
}
