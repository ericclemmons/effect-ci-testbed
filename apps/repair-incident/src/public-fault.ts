import { healthStatus } from "../fixtures/public-health.js";

/** Host-authored public TEST source. Never accepts an error, prompt or identity
 * from the request. Deployment and automatic admission must be enrolled before
 * the host enables this route; it is disabled in the production entrypoint.
 */
export const PUBLIC_EMISSION_ID = "owned-public-health-500-v1";
export const PUBLIC_ERROR_MESSAGE =
  "Effect CI owned public health fixture returned 500 (owned-public-health-500-v1)";
// Actual fixed fixture bytes are checked by the local regression and pinned
// together with the exact deployed version/source by the host enrollment.
export const PUBLIC_FIXTURE_DIGEST =
  "6e3a3627b9fd217104ff0b7d73aba6968d2422558539af3aac2f5f2625ef6dd6";
export interface PublicFaultClaim {
  /** A durable claim MUST precede the exception. Lost ACKs fail closed. */
  claim(): Promise<boolean>;
}

export async function publicFaultFetch(
  request: Request,
  claim: PublicFaultClaim,
): Promise<Response> {
  const url = new URL(request.url);
  // HEAD, speculative prefetch and ordinary root probes must not consume the test.
  if (url.pathname !== "/failure" || url.search)
    return new Response("Not found", { status: 404 });
  if (request.method !== "GET")
    return new Response("Method not allowed", { status: 405 });
  if (
    request.headers.has("purpose") ||
    request.headers.has("sec-purpose") ||
    request.headers.has("x-moz")
  )
    return new Response("Prefetch not allowed", { status: 412 });
  if (healthStatus() !== 500)
    return new Response("Owned fixture changed", { status: 409 });
  let claimed;
  try {
    claimed = await claim.claim();
    if (claimed !== true && claimed !== false) throw new Error("Invalid claim");
  } catch {
    // Storage/ACK uncertainty is not the enrolled fixture failure and must not
    // manufacture another HTTP5xx Issue. Do not retry or expose the raw error.
    return new Response("Owned test claim unavailable", {
      status: 409,
      headers: { "cache-control": "no-store" },
    });
  }
  if (!claimed)
    // A cached 500 could itself create another platform occurrence. Never replay
    // that response, log the error again or reset the durable source for rehearsal.
    return new Response("Owned test already claimed", {
      status: 410,
      headers: { "cache-control": "no-store" },
    });
  // Deliberately uncaught at the HTTP Worker boundary: this must be a real fetch
  // exception/HTTP500, not a private jsrpc console.error relabelled as a URL test.
  throw new Error(PUBLIC_ERROR_MESSAGE);
}
