export class AuthenticationError extends Error {}

export function brokerOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new AuthenticationError("broker-url must be an HTTPS origin");
  }
  return url.origin;
}

export async function exchange({ broker, worker, scopes, requestUrl, requestToken }, fetcher = fetch) {
  const origin = brokerOrigin(broker);
  if (!requestUrl || !requestToken) throw new AuthenticationError("Grant this job permissions: id-token: write");
  const oidcUrl = new URL(requestUrl);
  oidcUrl.searchParams.set("audience", origin);
  const identityResponse = await fetcher(oidcUrl, {
    headers: { authorization: `Bearer ${requestToken}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!identityResponse.ok) throw new AuthenticationError("GitHub OIDC request failed");
  const { value } = await identityResponse.json();
  if (typeof value !== "string" || !value) throw new AuthenticationError("GitHub OIDC token missing");
  const response = await fetcher(`${origin}/token`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${value}`, "content-type": "application/json" },
    body: JSON.stringify({ worker, scopes: scopes.split(/\s+/).filter(Boolean) }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const stage = ["configuration", "identity", "grant", "issuance"].includes(body.stage) ? `; stage=${body.stage}` : "";
    throw new AuthenticationError(`Effect CI credential exchange failed (${response.status}${stage})`);
  }
  const result = await response.json();
  if (typeof result.token !== "string" || !result.token || /[\r\n]/.test(result.token)
    || typeof result.receipt !== "string" || !result.receipt || /[\r\n]/.test(result.receipt)
    || !/^[a-f0-9]{32}$/.test(result.accountId)) throw new AuthenticationError("Invalid broker response");
  return { ...result, broker: origin };
}

export async function revoke(broker, receipt, fetcher = fetch) {
  const response = await fetcher(`${brokerOrigin(broker)}/revoke`, {
    method: "POST", headers: { authorization: `Bearer ${receipt}` },
    redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Effect CI revocation failed; token expiration remains in effect");
}
