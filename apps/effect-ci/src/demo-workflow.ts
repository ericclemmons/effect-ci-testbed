import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { demoRunAllowed } from "./demo-policy.ts";
import { demoProgram } from "./demo-program.ts";
import { demoCheckCache } from "./demo-check-cache.ts";

// The host enrolls this package and task names at deployment. Its pushed source
// and package scripts still execute in the native workspace, never in the host.
const Base = GitHubCloudflare.workflowEntrypoint(demoProgram.workflow, {
  root: "examples/demo",
  // Whole-container cache snapshots may contain project-modified system files.
  // Signed input identification must start from the owned immutable image.
  cache: false,
  container: { image: "workspace", instance: "standard-1" },
  notificationChannels: () => ({}),
  checkCache: (_environment, { runner }) => demoCheckCache(runner),
});

export class DemoCIWorkflow extends Base {
  override async run(
    event: Readonly<WorkflowEvent<GitHubCloudflare.WorkflowParameters>>,
    step: WorkflowStep,
  ) {
    if (event.payload.trigger !== "remote" || !demoRunAllowed(event.payload)) {
      throw new Error("Demo workflow requires its enrolled repository and full revision");
    }
    return super.run(event, step);
  }
}
