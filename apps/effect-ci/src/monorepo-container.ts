import { WorkspaceContainer as Base } from "@effect-ci-testbed/cloudflare";
import { platformApps } from "../../../.cloudflare/ci/workflow.ts";
import { WorkerEntrypoint } from "cloudflare:workers";
import { DeploymentProxy, deploymentToken } from "./deployment-proxy.ts";
import { showcaseProcessPrefix } from "./showcase-process-policy.ts";

export class CloudflareDeploymentOutbound extends WorkerEntrypoint<unknown, { workspaceId: string; capability: string }> {
  override fetch(request: Request): Promise<Response> {
    const namespace = (this.ctx.exports as unknown as { WorkspaceContainer: DurableObjectNamespace<WorkspaceContainer> }).WorkspaceContainer;
    return namespace.get(namespace.idFromString(this.ctx.props.workspaceId)).deploymentFetch(request, this.ctx.props.capability);
  }
}

const commands = new Set([
  "./node_modules/.bin/cf workers triggers deploy --prebuilt",
  "./node_modules/.bin/cf deploy --prebuilt",
]);

/** Normal cf commands use host-authenticated outbound HTTPS. No real account
 * or registry credential enters a process environment, disk or snapshot. */
export class WorkspaceContainer extends Base {
  private deployment: { command: string; cwd: string; env: Record<string, string>; capability: string; proxy: DeploymentProxy } | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  protected override processCommand(command: ReadonlyArray<string>, _cwd: string | undefined,
    options: Parameters<Base["processCommand"]>[2]): ReadonlyArray<string> {
    return options.image === "showcase" ? [...showcaseProcessPrefix, ...command] : command;
  }

  async allowMainDeployment(revision: string) {
    if (!/^[a-f0-9]{40}$/.test(revision)) throw Error("Invalid main deployment revision");
    await this.ctx.storage.put("mainDeployment", revision);
  }

  protected override async processEnvironment(command: ReadonlyArray<string>, cwd?: string) {
    const active = this.deployment;
    if (active && command.at(-1) === active.command && cwd === active.cwd) return active.env;
    // Container exec does not inherit Dockerfile ENV. cf's image builder needs
    // this non-secret setting explicitly to avoid nested bridge/IPv6 setup.
    if (command.at(-1) === "pnpm build" && platformApps.some(app => cwd === `/workspace/repository/apps/${app}`))
      return { WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST: "1" };
    return undefined;
  }

  protected override async configureOutbound() {
    const active = this.deployment;
    if (!active) return;
    const outbound = (this.ctx.exports as unknown as {
      CloudflareDeploymentOutbound(options: { props: { workspaceId: string; capability: string } }): Fetcher;
    }).CloudflareDeploymentOutbound({ props: { workspaceId: this.ctx.id.toString(), capability: active.capability } });
    for (const host of ["api.cloudflare.com", "registry.cloudflare.com"])
      await this.ctx.container!.interceptOutboundHttps(host, outbound);
    // HTTPS interception signs responses with an ephemeral runtime CA. The
    // plain Node image does not trust it automatically (unlike Sandbox SDK).
    // Install public trust material for Docker/Go; Node uses the explicit env
    // below. Do this after registration and before any authenticated request.
    const trust = await this.ctx.container!.exec(["sh", "-ec",
      "test -s /etc/cloudflare/certs/cloudflare-containers-ca.crt && " +
      "cp /etc/cloudflare/certs/cloudflare-containers-ca.crt /usr/local/share/ca-certificates/cloudflare-containers-ca.crt && " +
      // dockerd already pulled build images and may have cached system roots.
      // Registry-specific CA roots are read when opening that registry client.
      "mkdir -p /etc/docker/certs.d/registry.cloudflare.com && " +
      "cp /etc/cloudflare/certs/cloudflare-containers-ca.crt /etc/docker/certs.d/registry.cloudflare.com/ca.crt && " +
      "update-ca-certificates >/dev/null",
    ]);
    if ((await trust.output()).exitCode !== 0)
      throw Error("Could not trust the Cloudflare deployment outbound HTTPS certificate");
  }

  async deploymentFetch(request: Request, capability: string): Promise<Response> {
    const active = this.deployment;
    return active && capability === active.capability ? active.proxy.fetch(request)
      : new Response("Deployment proxy inactive", { status: 403 });
  }

  override execute(...args: Parameters<Base["execute"]>): ReturnType<Base["execute"]> {
    const run = this.queue.then(async () => {
      const [command, cwd, stepId] = args;
      const app = platformApps.find(app => stepId === `deploy ${app}` && cwd === `/workspace/repository/apps/${app}`);
      if (!app || !commands.has(command)) return super.execute(...args);
      if (!await this.ctx.storage.get("mainDeployment"))
        return { exitCode: 1, stdout: "", stderr: "Cloudflare deployment is restricted to an authenticated main run." };
      const env = this.env as { CLOUDFLARE_API_TOKEN?: string; CLOUDFLARE_ACCOUNT_ID?: string };
      if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID)
        return { exitCode: 1, stdout: "", stderr: "Configure CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID on the CI host for native main CD." };
      const dockerConfig = `/tmp/effect-ci-docker-${crypto.randomUUID()}`;
      this.deployment = { command, cwd, capability: crypto.randomUUID(),
        proxy: new DeploymentProxy(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_API_TOKEN), env: {
        CLOUDFLARE_API_TOKEN: deploymentToken, CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
        WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST: "1",
        NODE_EXTRA_CA_CERTS: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
        DOCKER_CONFIG: dockerConfig,
      } };
      try {
        const result = await super.execute(...args);
        const redact = (value: string) => value.replaceAll(env.CLOUDFLARE_API_TOKEN!, "[redacted]");
        return { ...result, stdout: redact(result.stdout), stderr: redact(result.stderr) };
      } finally {
        this.deployment = undefined;
        // Remove Docker's dummy login directory before checkpointing too.
        const cleanup = await this.ctx.container!.exec(["rm", "-rf", dockerConfig]);
        if ((await cleanup.output()).exitCode !== 0)
          throw Error("Could not clear the deployment registry login");
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async stop() {
    await this.ctx.storage.delete("mainDeployment");
    if (this.ctx.container?.running) await this.ctx.container.destroy("Monorepo CI finished");
  }
}
