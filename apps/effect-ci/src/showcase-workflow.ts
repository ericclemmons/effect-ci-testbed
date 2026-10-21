import * as CI from "@effect-ci-testbed/ci";
import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { DemoAssets } from "@effect-ci-testbed/cloudflare/demo-site";
import { showcaseProgram } from "./showcase-program.ts";
import { finalizeShowcaseRun } from "./showcase-release.ts";
import { showcaseGitHubAllowed, showcaseProductionAllowed, showcaseRunAllowed, showcaseSelection } from "./showcase-policy.ts";
import { demoWorkspaceResultCache } from "./demo-workspace-result-cache.ts";
import { showcaseBuildIdentity, showcaseRoot } from "./showcase-runner-policy.ts";
import type { RunnerStepAuthority } from "@effect-ci-testbed/cloudflare/runner-step-result";
import * as Effect from "effect/Effect";
import { decodeShowcasePublication } from "./showcase-protocol.ts";
import { cleanupShowcase } from "./showcase-cleanup.ts";
import { showcaseCheckCache } from "./showcase-check-cache.ts";
import type { RunnerCheckAuthority } from "@effect-ci-testbed/cloudflare/runner-check-receipt";

const Base = GitHubCloudflare.workflowEntrypoint<unknown>((environment, parameters) => {
  const selection = showcaseSelection(parameters);
  const publisher = (environment as unknown as {
    DEMO_SITE: { publish: (revision: string, assets: DemoAssets) => Promise<unknown> };
  }).DEMO_SITE;
  const program = showcaseProgram({
    revision: parameters.revision,
    publish: (revision, assets) => publisher.publish(revision, assets),
  });
  if (!selection) return program.workflow;
  // Explicit computation goals cannot reach publication or release finalization.
  return CI.workflow("demo", () => CI.parallel(selection.map(goal => program[goal]())));
}, {
  root: "examples/demo",
  cache: false,
  container: { image: "showcase", instance: "standard-1", loginShell: false,
    readyCommand: "/usr/local/bin/node -e 'if(process.getuid()!==1000)process.exit(1)'" },
  slackLayout: "status-thread",
  slackCommandOutput: "failed",
  slackCommandLog: ({ exports, instanceId, stepId, threadTs, text }) => {
    const host = exports as { PrivateSlackImages: { getByName(name: string): {
      uploadLog(runId: string, stepId: string, threadTs: string, text: string): Promise<{ ok: true; fileId: string } | { ok: false }>;
    } } };
    return host.PrivateSlackImages.getByName(instanceId).uploadLog(instanceId, stepId, threadTs, text);
  },
  slackProgressSteps: parameters => {
    const selected = showcaseSelection(parameters);
    if (selected) return ["checkout", "install", ...(selected.includes("build") ? ["lint", "test", "build"] : selected)];
    return ["checkout", "install", "lint", "test", "build", "publish preview",
      ...(showcaseProductionAllowed(parameters) ? ["Start rollout", "Release 10%", "Release 25%", "Release 75%", "Release 100%"] : [])];
  },
  finalize: finalizeShowcaseRun,
  finalizationCheck: parameters => showcaseProductionAllowed(parameters) ? "Rollout / conference demo" : "Preview / conference demo",
  checkCache: (environment, { runner, exports, instanceId }) => {
    const authority = (exports as { TrustedDemoChecks: { getByName(name: string): RunnerCheckAuthority } }).TrustedDemoChecks.getByName("showcase-trusted-runner-v1");
    return showcaseCheckCache(runner, instanceId, authority, (environment as { VERSION_METADATA?: { id: string } }).VERSION_METADATA?.id);
  },
  stepResultCache: (environment, { runner, exports, instanceId }) => {
    const authority = (exports as { TrustedDemoChecks: { getByName(name: string): RunnerStepAuthority } }).TrustedDemoChecks.getByName("showcase-trusted-runner-v1");
    const version = (environment as { VERSION_METADATA?: { id: string } }).VERSION_METADATA?.id;
    return demoWorkspaceResultCache(runner, instanceId, authority, version,
      { workflowId: "demo", cwd: showcaseRoot, identity: showcaseBuildIdentity });
  },
  executionEvidence: async ({ exports, parameters, value }) => {
    const authority = (exports as { TrustedDemoChecks: { getByName(name: string): { forCommit(revision: string): Promise<object> } } }).TrustedDemoChecks.getByName("showcase-trusted-runner-v1");
    const signed = await authority.forCommit(parameters.revision);
    if (showcaseSelection(parameters)) return signed;
    // Add only the decoded public publication receipt, not the workflow's
    // unchecked value, a live Workspace, or raw command output.
    return { ...signed, publication: await Effect.runPromise(decodeShowcasePublication(value)) };
  },
});

/** Enrolled owned app only. Incoming project modules never execute in the host. */
export class ShowcaseCIWorkflow extends Base {
  override async run(event: Readonly<WorkflowEvent<GitHubCloudflare.WorkflowParameters>>, step: WorkflowStep) {
    const parameters = event.payload;
    const selected = showcaseSelection(parameters);
    if (parameters.trigger === "github" ? !showcaseGitHubAllowed(parameters) || selected !== undefined : !showcaseRunAllowed(parameters))
      throw Error("Showcase source is not enrolled");
    let failed = false;
    try { return await super.run(event, step); }
    catch (error) { failed = true; throw error; }
    finally {
      try { await cleanupShowcase(step, this.ctx.exports, event.instanceId); }
      catch (error) {
        if (!failed) throw error;
        console.error("Showcase cleanup failed after workflow failure; see cleanup checkpoint");
      }
    }
  }
}
