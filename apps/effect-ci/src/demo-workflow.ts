import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { demoRunAllowed, demoGitHubAllowed, demoProductionAllowed, demoRemoteSelection } from "./demo-policy.ts";
import { makeDemoProgram } from "./demo-program.ts";
import type { DemoAssets } from "@effect-ci-testbed/cloudflare/demo-site";
import type { DemoCandidateReceipt } from "@effect-ci-testbed/cloudflare/demo-candidate";
import { demoCheckCache } from "./demo-check-cache.ts";
import { withDemoEvidenceRead } from "./demo-evidence-reader.ts";
import { finalizeDemoRun } from "./demo-run-finalizer.ts";

// The host enrolls this package and task names at deployment. Its pushed source
// and package scripts still execute in the native workspace, never in the host.
const Base = GitHubCloudflare.workflowEntrypoint(
  (environment, parameters) => {
    if (parameters.trigger === "remote") {
      const selection = demoRemoteSelection(parameters);
      if (selection) return makeDemoProgram(undefined, selection).workflow;
    }
    const publisher = (
      environment as unknown as {
        DEMO_SITE?: {
          publish: (
            revision: string,
            assets: DemoAssets,
          ) => Promise<{ revision: string; digest: string; url: string }>;
        };
      }
    ).DEMO_SITE;
    if (!publisher) throw Error("Owned demo site publisher is not configured");
    const release = (
      environment as unknown as {
        RELEASE_MANAGER?: {
          prepareCandidate: (revision: string, digest: string) => Promise<DemoCandidateReceipt>;
        };
      }
    ).RELEASE_MANAGER;
    if (!release) throw Error("Owned release manager is not configured");
    return makeDemoProgram({
      revision: parameters.revision,
      publish: (assets) => publisher.publish(parameters.revision, assets),
      // Preview branches publish immutable static bytes, never a production
      // candidate or release approval. Remote CLI is also publication-only.
      ...(parameters.trigger === "github" && demoProductionAllowed(parameters)
        ? { prepare: (revision: string, digest: string) => release.prepareCandidate(revision, digest) }
        : {}),
    }).workflow;
  },
  {
    root: "examples/demo",
    // Whole-container cache snapshots may contain project-modified system files.
    // Signed input identification must start from the owned immutable image.
    cache: false,
    slackLayout: "status-thread",
    container: { image: "workspace", instance: "standard-1" },
    notificationChannels: (environment, parameters) => parameters.trigger === "github" && demoGitHubAllowed(parameters) ? environment : {},
    finalize: finalizeDemoRun,
    checkCache: (environment, { runner }) =>
      demoCheckCache(runner, (operation) =>
        withDemoEvidenceRead(
          {
            appId: environment.GITHUB_APP_ID,
            privateKey: environment.GITHUB_PRIVATE_KEY,
          },
          operation,
        ),
      ),
  },
);

export class DemoCIWorkflow extends Base {
  override async run(
    event: Readonly<WorkflowEvent<GitHubCloudflare.WorkflowParameters>>,
    step: WorkflowStep,
  ) {
    if (!(event.payload.trigger === "remote" ? demoRunAllowed(event.payload) : demoGitHubAllowed(event.payload))) {
      throw new Error("Demo workflow requires its enrolled repository and full revision");
    }
    return super.run(event, step);
  }
}
