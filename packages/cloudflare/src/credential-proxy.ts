/** One scoped credential capability, never a general-purpose authenticated proxy. */
export const credentialRequest = async (
  request: Request,
  credential: () => Promise<string>,
  upstream: (request: Request) => Promise<Response>,
): Promise<Response> => {
  const url = new URL(request.url)
  if (url.origin !== "http://credential.ci" || url.pathname !== "/verify" || url.search ||
      request.method !== "GET" || request.headers.get("authorization") !== "Bearer effect-ci-placeholder") {
    return new Response("Credential capability denied", { status: 403 })
  }
  try {
    const token = await credential()
    const response = await upstream(new Request("https://credential.internal/verify", {
      method: "GET", headers: { authorization: `Bearer ${token}` }, redirect: "manual",
    }))
    // Never forward response bodies/headers: upstreams may reflect credentials.
    if (response.status !== 200) return new Response("Authentication failed", { status: 502 })
    return Response.json({ authenticated: true })
  } catch {
    // Provider errors may contain headers or credentials too.
    return new Response("Authentication failed", { status: 502 })
  }
}
