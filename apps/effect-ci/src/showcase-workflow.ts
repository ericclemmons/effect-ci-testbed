import * as CI from "@effect-ci-testbed/ci";
import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { DemoAssets } from "@effect-ci-testbed/cloudflare/demo-site";
import { showcaseProgram } from "./showcase-program.ts";
import { finalizeShowcaseRun } from "./showcase-release.ts";
import { showcaseGitHubAllowed, showcaseProductionAllowed, showcaseRunAllowed, showcaseSelection } from "./showcase-policy.ts";
import { demoWorkspaceResultCache } from "./demo-workspace-result-cache.ts";
import { showcaseBuildIdentity, showcaseRoot, showcaseAuthorityName } from "./showcase-runner-policy.ts";
import type { RunnerStepAuthority } from "@effect-ci-testbed/cloudflare/runner-step-result";
import * as Effect from "effect/Effect";
import { decodeShowcasePublication } from "./showcase-protocol.ts";
import { cleanupShowcase } from "./showcase-cleanup.ts";
import { showcaseCheckCache } from "./showcase-check-cache.ts";
import type { RunnerCheckAuthority } from "@effect-ci-testbed/cloudflare/runner-check-receipt";
import { showcaseReadyCommand } from "./showcase-process-policy.ts";
import { followUpShowcaseFailure } from "./showcase-modeled-repair.ts";
import { retainShowcaseAttempt, restoreShowcaseAttempt } from "./showcase-attempt.ts";
import { ShowcaseRerun } from "./showcase-protocol.ts";
import * as Schema from "effect/Schema";
import { prepareExecutionClaim } from "@effect-ci-testbed/cloudflare/execution-receipt";
import { showcaseExecutionContext, showcaseExecutionIdentity, showcaseExecutionVersion,
  type ShowcaseExecutionAuthority } from "./showcase-execution.ts";

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
    readyCommand: showcaseReadyCommand },
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
  onFailure: followUpShowcaseFailure,
  finalizationCheck: parameters => showcaseProductionAllowed(parameters) ? "Rollout / conference demo" : "Preview / conference demo",
  onAttempt: async (attempt, { environment, exports, parameters, instanceId }) => {
    const context = showcaseExecutionContext(parameters);
    const identity = await showcaseExecutionIdentity(context, showcaseExecutionVersion(environment));
    // Hash SDK workspace values here, before RPC transports erase their classes.
    const claim = await prepareExecutionClaim({ identity, instanceId, attempt });
    const authority = (exports as { TrustedDemoChecks: { getByName(name: string): ShowcaseExecutionAuthority } }).TrustedDemoChecks;
    const store = authority.getByName(showcaseAuthorityName);
    await store.recordExecution(context, claim);
    const retained = retainShowcaseAttempt(attempt, { revision: parameters.revision,
      version: showcaseExecutionVersion(environment), instanceId });
    if (retained) await store.retainCompute(retained);
  },
  rerun: async (environment, { runner, exports, instanceId, parameters, step }) => {
    const { rerunFrom } = Schema.decodeUnknownSync(ShowcaseRerun)(parameters);
    if (rerunFrom === undefined) return;
    if (parameters.trigger !== "remote") throw Error("Only explicit remote compute reruns are enrolled");
    const steps = parameters.targets ?? [parameters.target!];
    const authority = (exports as { TrustedDemoChecks: { getByName(name: string): ShowcaseExecutionAuthority } }).TrustedDemoChecks;
    const retained = await step.do("showcase:compute-rerun-input", {
      retries: { limit: 0, delay: "1 second" }, timeout: "1 minute",
    }, async () => {
      const previous = await authority.getByName(showcaseAuthorityName).computeAttempt(parameters.revision, rerunFrom);
      if (!previous) throw Error("No completed same-commit compute attempt is available");
      return previous;
    });
    const previous = restoreShowcaseAttempt(retained, { revision: parameters.revision,
      version: showcaseExecutionVersion(environment), instanceId });
    const selection = CI.planRerun(previous.plan, steps);
    for (const id of selection.reuse) {
      const value = previous.outputs[id];
      if (value instanceof CI.Workspace && !await Effect.runPromise(runner.fileSystem.exists(value, ".", id)))
        throw Error("Previous compute snapshot is unavailable; start a fresh computation");
    }
    return { previous, steps };
  },
  checkCache: (environment, { runner, exports, instanceId, parameters }) => {
    // An explicit rerun recomputes affected nodes. Unaffected nodes come from
    // the retained attempt; old signed checks are not rewritten or revoked.
    if (parameters.trigger === "remote" && parameters.rerunFrom)
      return { lookup: () => Effect.succeed(false), record: () => Effect.void };
    const authority = (exports as { TrustedDemoChecks: { getByName(name: string): RunnerCheckAuthority } }).TrustedDemoChecks.getByName(showcaseAuthorityName);
    return showcaseCheckCache(runner, instanceId, authority, (environment as { VERSION_METADATA?: { id: string } }).VERSION_METADATA?.id);
  },
  stepResultCache: (environment, { runner, exports, instanceId, parameters }) => {
    if (parameters.trigger === "remote" && parameters.rerunFrom)
      return { lookup: () => Effect.succeed(undefined), record: () => Effect.void };
    const authority = (exports as { TrustedDemoChecks: { getByName(name: string): RunnerStepAuthority } }).TrustedDemoChecks.getByName(showcaseAuthorityName);
    const version = (environment as { VERSION_METADATA?: { id: string } }).VERSION_METADATA?.id;
    return demoWorkspaceResultCache(runner, instanceId, authority, version,
      { workflowId: "demo", cwd: showcaseRoot, identity: showcaseBuildIdentity });
  },
  executionEvidence: async ({ exports, parameters, value }) => {
    const authority = (exports as { TrustedDemoChecks: { getByName(name: string): { forCommit(revision: string): Promise<{
      keyId: string; publicKey: JsonWebKey; receipts: ReadonlyArray<unknown>;
    }> } } }).TrustedDemoChecks.getByName(showcaseAuthorityName);
    const privateResults = await authority.forCommit(parameters.revision);
    // Snapshot-bearing workspace-result receipts stay in private host storage.
    // Public execution observations commit their outputs without exposing handles.
    const signed = { keyId: privateResults.keyId, publicKey: privateResults.publicKey, receipts: privateResults.receipts };
    const journal = (exports as { TrustedDemoChecks: { getByName(name: string): ShowcaseExecutionAuthority } }).TrustedDemoChecks;
    const executions = await journal.getByName(showcaseAuthorityName).executionHistory(parameters.revision);
    if (showcaseSelection(parameters)) return { ...signed, executions };
    // Add only the decoded public publication receipt, not the workflow's
    // unchecked value, a live Workspace, or raw command output.
    return { ...signed, executions, publication: await Effect.runPromise(decodeShowcasePublication(value)) };
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
