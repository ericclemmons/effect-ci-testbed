import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { demoRunAllowed, demoGitHubAllowed, demoProductionAllowed, demoRemoteSelection } from "./demo-policy.ts";
import { makeDemoProgram } from "./demo-program.ts";
import type { DemoAssets } from "@effect-ci-testbed/cloudflare/demo-site";
import type { DemoCandidateReceipt } from "@effect-ci-testbed/cloudflare/demo-candidate";
import { demoRunnerCheckCache } from "./demo-runner-check-cache.ts";
import type { RunnerCheckAuthority } from "@effect-ci-testbed/cloudflare/runner-check-receipt";
import { finalizeDemoRun } from "./demo-run-finalizer.ts";
import { demoWorkspaceResultCache } from "./demo-workspace-result-cache.ts";
import type { RunnerStepAuthority } from "@effect-ci-testbed/cloudflare/runner-step-result";
import { demoTrustedReadyCommand } from "./demo-runner-policy.ts";

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
    root: "test/fixtures/demo",
    // Whole-container cache snapshots may contain project-modified system files.
    // Signed input identification must start from the owned immutable image.
    cache: false,
    slackLayout: "status-thread",
    slackCommandOutput: "failed",
    slackCommandLog: ({ exports, instanceId, stepId, threadTs, text }) => {
      const host = exports as { PrivateSlackImages: { getByName(name: string): {
        uploadLog(runId: string, stepId: string, threadTs: string, text: string): Promise<{ ok: true; fileId: string } | { ok: false }>
      } } };
      return host.PrivateSlackImages.getByName(instanceId).uploadLog(instanceId, stepId, threadTs, text);
    },
    slackProgressSteps: (parameters) => ["checkout", "syntax", "install", "lint", "check", "typecheck", "test", "build", "verify build", "publish site",
      ...(parameters.trigger === "github" && demoProductionAllowed(parameters) ? ["prepare release", "Release 10%", "Release 25%", "Release 75%", "Release 100%"] : [])],
    container: { image: "trusted-demo", instance: "standard-1", loginShell: false, readyCommand: demoTrustedReadyCommand },
    notificationChannels: (environment, parameters) => parameters.trigger === "github" && demoGitHubAllowed(parameters) ? environment : {},
    finalize: finalizeDemoRun,
    finalizationCheck: parameters => parameters.trigger === "github" && demoProductionAllowed(parameters)
      ? "Deployment / cf-ci-demo" : undefined,
    executionEvidence: ({ exports, parameters }) => {
      const host = exports as { TrustedDemoChecks: { getByName(name: string): {
        forCommit(revision: string): Promise<unknown>
      } } };
      return host.TrustedDemoChecks.getByName("demo-trusted-runner-v1").forCommit(parameters.revision);
    },
    checkCache: (_environment, { runner, exports, instanceId }) => {
      const host = exports as { TrustedDemoChecks: { getByName(name: string): RunnerCheckAuthority } };
      return demoRunnerCheckCache(runner, instanceId, host.TrustedDemoChecks.getByName("demo-trusted-runner-v1"));
    },
    stepResultCache: (environment, { runner, exports, instanceId }) => {
      const host = exports as { TrustedDemoChecks: { getByName(name: string): RunnerStepAuthority } };
      const version = (environment as unknown as { VERSION_METADATA?: { id: string } }).VERSION_METADATA?.id;
      return demoWorkspaceResultCache(runner, instanceId, host.TrustedDemoChecks.getByName("demo-trusted-runner-v1"), version);
    },
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
