import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { exampleDetailsUrl, selectedExample } from "./hosted-examples.ts";
import { standaloneContainerOptions } from "./standalone-program.ts";

// Unprivileged repository image, like other repository runs: no Docker,
// deployment proxy, credentials or Slack card. Small instances keep examples
// from competing with the monorepo's standard-4 deploy path.
const Base = GitHubCloudflare.workflowEntrypoint((_environment, parameters) => {
  const example = selectedExample(parameters);
  if (!example) throw Error("Hosted examples require their authenticated source and an enrolled project");
  return example.workflow;
}, {
  cache: false,
  root: parameters => selectedExample(parameters) && parameters.trigger === "github" ? parameters.project?.root : undefined,
  detailsUrl: exampleDetailsUrl,
  notificationChannels: () => ({}),
  container: { ...standaloneContainerOptions, image: "repository", instance: "standard-1" },
});

type Containers = { getByName(name: string): { stop(): Promise<void> } };

export class ExampleCIWorkflow extends Base {
  override async run(event: Readonly<WorkflowEvent<GitHubCloudflare.WorkflowParameters>>, step: WorkflowStep) {
    // Examples declare their own steps, so record this run's containers rather
    // than duplicating each graph. Replay re-resolves them before each command.
    const containers = (this.ctx.exports as unknown as { WorkspaceContainer: Containers }).WorkspaceContainer;
    const used = new Set([event.instanceId]);
    this.env = { ...this.env, Workspace: { getByName: (name: string) => {
      if (name.startsWith(`${event.instanceId}:`)) used.add(name);
      return containers.getByName(name);
    } } as unknown as DurableObjectNamespace };
    let failed = false;
    try {
      return await super.run(event, step);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        await step.do("example:cleanup", { timeout: "30 seconds", retries: { limit: 0, delay: "1 second", backoff: "constant" } },
          async () => {
            // Independent stops: one stuck provider call cannot keep the rest running.
            const results = await Promise.allSettled([...used].map(async name => containers.getByName(name).stop()));
            if (results.some(result => result.status === "rejected"))
              throw Error("One or more example containers could not stop");
          });
      } catch (error) {
        // Never replace the example's actual CI failure with a cleanup failure.
        if (!failed) throw error;
        console.error("Example cleanup failed after CI failure; see cleanup checkpoint");
      }
    }
  }
}
