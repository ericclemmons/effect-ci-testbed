/** Non-secret CLI credentials. Real credentials exist only in the host proxy. */
export const deploymentToken = "effect-ci-outbound-proxy";

/** One command's outbound authentication, discarded when that command exits. */
export class DeploymentProxy {
  private registry: { username: string; password: string } | undefined;
  private registryBearer: string | undefined;
  private readonly expires = Date.now() + 30 * 60_000;
  private readonly account: string;
  private readonly token: string;
  private readonly upstream: (request: Request) => Promise<Response>;
  constructor(account: string, token: string,
    // Workers' global fetch requires its global receiver. Storing fetch itself
    // and invoking this.upstream(request) binds it to this proxy (Node permits
    // that, Workerd throws). Keep the default call in the global scope.
    upstream: (request: Request) => Promise<Response> = request => fetch(request)) {
    this.account = account; this.token = token; this.upstream = upstream;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const deny = () => new Response("Deployment proxy request denied", { status: 403 });
    if (Date.now() >= this.expires || url.protocol !== "https:" || url.port) return deny();
    const api = url.hostname === "api.cloudflare.com";
    const registry = url.hostname === "registry.cloudflare.com";
    if (!api && !registry) return deny();
    if (api && !url.pathname.startsWith(`/client/v4/accounts/${this.account}/`)
      && url.pathname !== "/client/v4/user/tokens/verify") return deny();
    if (registry && !this.registry) return deny();
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    headers.set("authorization", api ? `Bearer ${this.token}`
      : request.headers.get("authorization") === `Bearer ${deploymentToken}` && this.registryBearer
        ? `Bearer ${this.registryBearer}`
        : `Basic ${btoa(`${this.registry!.username}:${this.registry!.password}`)}`);
    try {
      const response = await this.upstream(new Request(request, { headers, redirect: "manual" }));
      // cf's Docker login also stays outside the VM: Docker receives dummy
      // credentials and this same outbound proxy authenticates registry traffic.
      if (api && url.pathname === `/client/v4/accounts/${this.account}/containers/registries/registry.cloudflare.com/credentials`
        && response.ok) {
        const body = await response.json() as { result?: { username?: string; password?: string } };
        const credentials = body.result;
        if (!credentials?.username || !credentials.password) return new Response("Invalid registry credentials response", { status: 502 });
        this.registry = { username: credentials.username, password: credentials.password };
        return Response.json({ ...body, result: { ...credentials, username: deploymentToken, password: deploymentToken } });
      }
      if (registry && response.ok && response.headers.get("content-type")?.includes("application/json")) {
        const body = await response.clone().json() as Record<string, unknown>;
        // Some registries exchange Basic login for a bearer token. Keep that
        // exchange host-only as well; Docker continues with an opaque marker.
        if (typeof body.token === "string" || typeof body.access_token === "string") {
          this.registryBearer = (body.token ?? body.access_token) as string;
          return Response.json({ ...body,
            ...(body.token ? { token: deploymentToken } : {}),
            ...(body.access_token ? { access_token: deploymentToken } : {}) });
        }
      }
      // Never follow an authenticated redirect in the host. Docker can follow
      // registry upload locations itself; that request is intercepted again.
      return response;
    } catch {
      return new Response("Deployment upstream request failed", { status: 502 });
    }
  }
}
