import { accessIdentityVerifier } from "@effect-ci-testbed/github-cloudflare/access-identity";
import { demoAccessIdentity, demoAccessOrigin } from "./demo-access-policy.ts";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";

const verifyIdentity = accessIdentityVerifier(demoAccessIdentity);
const showcaseRunRoutes = ["/showcase/runs/:id", "/showcase/runs/:id/events"]
  .map(pathname => new URLPattern({ pathname }));
const showcaseRunId = Schema.decodeUnknownOption(Schema.String.check(Schema.isUUID(undefined)));

/** This identity grants demo run/read access, never approval or other CI routes. */
export const demoRemoteAccessRoute = (request: Request): boolean => {
  const url = new URL(request.url), path = url.pathname;
  if (url.origin !== demoAccessOrigin) return false;
  if (path.startsWith("/showcase/")) {
    if (request.method === "POST") return path === "/showcase/runs";
    if (request.method !== "GET") return false;
    if (path === "/showcase/capabilities" || path === "/showcase/executions") return true;
    return showcaseRunRoutes.some(route => {
      const id = route.exec(url)?.pathname.groups.id;
      return id !== undefined && Option.isSome(showcaseRunId(id));
    });
  }
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
  if (!apiToken || request.headers.has("authorization") || !demoRemoteAccessRoute(request)) return request;
  // Access can authenticate browser cookies too. Do not let a cross-origin form
  // or fetch turn that ambient identity into a CLI workflow dispatch.
  const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  if ((origin !== null && origin !== demoAccessOrigin) ||
    (site !== null && !["none", "same-origin"].includes(site)) ||
    (request.method === "POST" && request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")) return request;
  if (!request.headers.has("cf-access-jwt-assertion") || !await verify(request)) return request;
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${apiToken}`);
  return new Request(request, { headers });
}
