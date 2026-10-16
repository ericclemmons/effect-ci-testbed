import { accessIdentityVerifier } from "@effect-ci-testbed/github-cloudflare/access-identity";
import { demoAccessIdentity, demoAccessOrigin } from "./demo-access-policy.ts";

const verifyIdentity = accessIdentityVerifier(demoAccessIdentity);

/** This identity grants demo run/read access, never approval or other CI routes. */
export const demoRemoteAccessRoute = (request: Request): boolean => {
  const url = new URL(request.url), path = url.pathname;
  if (url.origin !== demoAccessOrigin) return false;
  return (request.method === "GET" && path === "/demo/capabilities") ||
    (request.method === "POST" && path === "/demo/runs") ||
    (request.method === "GET" && /^\/demo\/runs\/[A-Za-z0-9_-]+(?:\/events)?$/.test(path));
};

/** Adapt only a verified enrolled human to the existing demo worker's auth gate.
 * The internal bearer never enters workflow parameters, responses or project code.
 * An explicit API credential retains its original semantics, even when invalid.
 */
export async function demoAccessRequest(request: Request, apiToken: string | undefined,
  verify: (request: Request) => Promise<boolean> = verifyIdentity): Promise<Request> {
  if (!apiToken || request.headers.has("authorization") || !demoRemoteAccessRoute(request) ||
    !request.headers.has("cf-access-jwt-assertion") || !await verify(request)) return request;
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${apiToken}`);
  return new Request(request, { headers });
}
