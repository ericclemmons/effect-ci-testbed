/** Only this host-owned endpoint may exchange the checkout capability for GitHub authentication. */
export const gitCheckoutHost = "github-checkout.ci"

export function githubCheckoutRepository(repository: string): string {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(repository)
  if (!match || match.slice(1).some((part) => part === "." || part === "..")) throw new Error("Authenticated checkout requires a canonical GitHub repository URL")
  return `${match[1]}/${match[2]}.git`
}

export async function gitCheckoutRequest(
  request: Request,
  repository: string,
  token: string,
  upstream: (request: Request) => Promise<Response> = fetch,
): Promise<Response> {
  const deny = () => new Response("Git checkout request denied", { status: 403 })
  const url = new URL(request.url)
  const root = `/${githubCheckoutRepository(repository)}`
  const advertisement = request.method === "GET" && url.pathname === `${root}/info/refs` && url.search === "?service=git-upload-pack"
  const uploadPack = request.method === "POST" && url.pathname === `${root}/git-upload-pack` && url.search === "" && request.headers.get("content-type") === "application/x-git-upload-pack-request"
  if (url.origin !== `http://${gitCheckoutHost}` || (!advertisement && !uploadPack) || request.headers.has("authorization")) return deny()
  try {
    const body = uploadPack ? await request.arrayBuffer() : undefined
    if (body && body.byteLength > 1024 * 1024) return deny()
    // Never copy container headers, cookies, authorization, or redirect policy.
    const headers = new Headers({ authorization: `Basic ${btoa(`x-access-token:${token}`)}` })
    if (uploadPack) headers.set("content-type", "application/x-git-upload-pack-request")
    const protocol = request.headers.get("git-protocol")
    if (protocol === "version=2") headers.set("git-protocol", protocol)
    const response = await upstream(new Request(`https://github.com${url.pathname}${url.search}`, { method: request.method, headers, ...(body ? { body } : {}), redirect: "manual" }))
    const type = advertisement ? "application/x-git-upload-pack-advertisement" : "application/x-git-upload-pack-result"
    // Error/redirect bodies and headers may reflect credentials. Do not relay them.
    if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0] !== type) {
      await response.body?.cancel()
      return new Response("Git checkout upstream failed", { status: 502 })
    }
    return new Response(response.body, { headers: { "content-type": type, "cache-control": "no-store" } })
  } catch {
    return new Response("Git checkout upstream failed", { status: 502 })
  }
}
