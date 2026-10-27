export class AuthenticationError extends Error {}

export function brokerOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new AuthenticationError("broker-url must be an HTTPS origin");
  }
  return url.origin;
}

export async function exchange({ broker, repository, worker, scopes, requestUrl, requestToken }, fetcher = fetch) {
  const origin = brokerOrigin(broker);
  if (repository !== undefined && (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))) {
    throw new AuthenticationError("Shared-host enrollment requires GITHUB_REPOSITORY");
  }
  if (!requestUrl || !requestToken) throw new AuthenticationError("Grant this job permissions: id-token: write");
  const oidcUrl = new URL(requestUrl);
  oidcUrl.searchParams.set("audience", origin);
  const identityResponse = await fetcher(oidcUrl, {
    headers: { authorization: `Bearer ${requestToken}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!identityResponse.ok) throw new AuthenticationError("GitHub OIDC request failed");
  const { value } = await identityResponse.json();
  if (typeof value !== "string" || !value) throw new AuthenticationError("GitHub OIDC token missing");
  if (repository !== undefined) {
    const enrollment = await fetcher(`${origin}/api/oidc/repositories`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${value}`, "content-type": "application/json" },
      body: JSON.stringify({ repository }),
    });
    if (!enrollment.ok) throw new AuthenticationError(`Effect CI enrollment failed (${enrollment.status}); check the GitHub App installation and allowed owner`);
    const result = await enrollment.json();
    if (result.enabled !== true || result.issuer !== origin || typeof result.repository !== "string"
      || result.repository.toLowerCase() !== repository.toLowerCase()) throw new AuthenticationError("Invalid enrollment response");
  }
  const response = await fetcher(`${origin}/token`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${value}`, "content-type": "application/json" },
    body: JSON.stringify({ worker, scopes: scopes.split(/\s+/).filter(Boolean) }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const stage = ["configuration", "identity", "grant", "issuance"].includes(body.stage) ? `; stage=${body.stage}` : "";
    const reason = /^(cloudflare-http-\d{3}|identity-already-exchanged|invalid-token-response|runtime-type-error|runtime-error)$/.test(body.reason ?? "") ? `; reason=${body.reason}` : "";
    throw new AuthenticationError(`Effect CI credential exchange failed (${response.status}${stage}${reason})`);
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
