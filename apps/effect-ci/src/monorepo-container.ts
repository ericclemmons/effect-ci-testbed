import { WorkspaceContainer as Base } from "@effect-ci-testbed/cloudflare";
import { platformApps } from "../../../.cloudflare/ci/workflow.ts";

const commands = new Set([
  "./node_modules/.bin/cf workers triggers deploy --prebuilt",
  "./node_modules/.bin/cf deploy --prebuilt",
]);

/** Normal cf commands get a main-only deployment environment. Checks,
 * package installation and builds never receive the account credential. */
export class WorkspaceContainer extends Base {
  private deployment: { command: string; cwd: string; env: Record<string, string> } | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  async allowMainDeployment(revision: string) {
    if (!/^[a-f0-9]{40}$/.test(revision)) throw Error("Invalid main deployment revision");
    await this.ctx.storage.put("mainDeployment", revision);
  }

  protected override async processEnvironment(command: ReadonlyArray<string>, cwd?: string) {
    const active = this.deployment;
    return active && command.at(-1) === active.command && cwd === active.cwd ? active.env : undefined;
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
      this.deployment = { command, cwd, env: {
        CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
        DOCKER_CONFIG: dockerConfig,
      } };
      try {
        const result = await super.execute(...args);
        const redact = (value: string) => value.replaceAll(env.CLOUDFLARE_API_TOKEN!, "[redacted]");
        return { ...result, stdout: redact(result.stdout), stderr: redact(result.stderr) };
      } finally {
        this.deployment = undefined;
        // cf performs a short-lived registry login. Remove that process's
        // generated login directory before the workspace can be checkpointed.
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
