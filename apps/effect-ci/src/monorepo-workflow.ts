import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import workflow, { platformApps } from "../../../.cloudflare/ci/workflow.ts";
import { monorepoAllowed } from "./monorepo-policy.ts";

// Run the root workflow directly, exactly like the consumer examples.
// No second publication graph, HMD finalizer, version broker or demo release.
const Base = GitHubCloudflare.workflowEntrypoint((_environment, parameters) => {
  if (parameters.trigger !== "github" || !monorepoAllowed(parameters))
    throw Error("Monorepo CI requires its authenticated source");
  return workflow;
}, { cache: false, durableCommands: true, slackLayout: "status-thread", slackCommandOutput: "failed",
  slackProgressSteps: parameters => ["checkout", "install", "check", "test", "build", "test and build tutorial", "deploy",
    ...(parameters.trigger === "github" && parameters.ref === "refs/heads/main"
      ? platformApps.map(app => `deploy ${app}`) : [])],
  container: { image: "ci", loginShell: false,
    entrypoint: ["sh", "-c", "dockerd --iptables=false --ip6tables=false --ip-forward=false --storage-driver=vfs >/tmp/dockerd.log 2>&1 & exec sleep infinity"],
    readyCommand: "for attempt in $(seq 1 100); do timeout 1 docker info >/dev/null 2>&1 && exit 0; sleep 0.2; done; cat /tmp/dockerd.log >&2; exit 1",
  } });

export class MonorepoCIWorkflow extends Base {
  override async run(event: Readonly<WorkflowEvent<GitHubCloudflare.WorkflowParameters>>, step: WorkflowStep) {
    const binding = (this.ctx.exports as unknown as { WorkspaceContainer: {
      getByName(name: string): { stop(): Promise<void>; allowMainDeployment(revision: string): Promise<void> };
    } }).WorkspaceContainer;
    let failed = false;
    try {
      const parameters = event.payload;
      if (parameters.trigger === "github" && monorepoAllowed(parameters) && parameters.ref === "refs/heads/main")
        await step.do("monorepo:allow-main-deployment", { retries: { limit: 0, delay: "1 second", backoff: "constant" } },
          async () => { for (const app of platformApps)
            await binding.getByName(`${event.instanceId}:step=deploy ${app}`).allowMainDeployment(parameters.revision); });
      return await super.run(event, step);
    } catch (error) {
      failed = true;
      throw error;
    }
    finally {
      try {
        await step.do("monorepo:cleanup", { timeout: "30 seconds", retries: { limit: 0, delay: "1 second", backoff: "constant" } },
          async () => {
            const steps = ["checkout", "install", "check", "test", "build", "test and build tutorial", "deploy",
              ...platformApps.map(app => `deploy ${app}`)];
            // Every workspace is independent. A stuck provider stop must not
            // prevent the other containers/host-only deployment leases clearing.
            const results = await Promise.allSettled([event.instanceId, ...steps.map(id => `${event.instanceId}:step=${id}`)]
              .map(async name => binding.getByName(name).stop()));
            if (results.some(result => result.status === "rejected"))
              throw Error("One or more monorepo containers could not stop");
          });
      } catch (error) {
        // The cleanup checkpoint retains its own failure. Do not overwrite the
        // actual CI error with its timeout or leak arbitrary provider details.
        if (!failed) throw error;
        console.error("Monorepo cleanup failed after CI failure; see cleanup checkpoint");
      }
    }
  }
}
