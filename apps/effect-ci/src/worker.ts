import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare";

import workflow from "./workflow.ts";
import { notificationChannels } from "./notification-policy.ts";
import { hmdSlackInteraction, isHmdSlackBody } from "./hmd-slack.ts";
import type { HmdApprovals, HmdCapability } from "./hmd-approval.ts";
import type { WorkerEnvironment } from "../../../packages/github-cloudflare/src/worker.ts";
import { demoRouteAllowed, demoRunAllowed, demoGitHubRun, demoRemoteTargets } from "./demo-policy.ts";
import { demoAccessRequest } from "./demo-access.ts";
import { runnerWebhook, type RunnerWebhookEnvironment } from "./runner-webhook.ts";
export { DemoCIWorkflow } from "./demo-workflow.ts";
export { StaticAssetSourceReader } from "./static-assets-source.ts";
export { PublicIncidentRepairOperations, PublicIncidentDispatcher, PublicIncidentRepairWorkflow, PublicPipelineReadiness } from "./public-incident-repair.ts";
export { DemoCandidateRecoveryWorkflow } from "./demo-candidate-recovery.ts";
export { DemoRoutingDiagnosticWorkflow } from "./demo-routing-diagnostic-workflow.ts";

export { WorkspaceContainer, GitCheckoutOutbound } from "@effect-ci-testbed/github-cloudflare";
export { HealthChartRenderer } from "./health-renderer.ts";
export { PrivateSlackImages } from "./private-images.ts";
export { PrivateSlackCards } from "./private-cards.ts";
export { HmdApprovals } from "./hmd-approval.ts";
export { HmdReviewWorkflow } from "./hmd-workflow.ts";
export { RepairVerifier, OwnedRepairVerificationWorkflow } from "./repair-verifier.ts";
export { IncidentRepairWriter, OwnedIncidentRepairOperations, OwnedIncidentRepairWorkflow } from "./incident-repair-writer.ts";
export {
  OwnedRepairOperations,
  RepairWriter,
  OwnedRepairProposalWorkflow,
} from "./repair-writer.ts";

const ci = GitHubCloudflare.worker({
  githubRun: demoGitHubRun,
});
const demo = GitHubCloudflare.worker({
  routePrefix: "/demo",
  remoteTargets: demoRemoteTargets,
  remoteAuthentication: ["api-token", "cloudflare-access-identity"],
  remoteRunAllowed: demoRunAllowed,
  workflow: (_environment, context) => {
    const binding = (context?.exports as unknown as {
      DemoCIWorkflow?: Workflow<GitHubCloudflare.WorkflowParameters>;
    } | undefined)?.DemoCIWorkflow;
    if (!binding) throw new Error("DemoCIWorkflow is not exported");
    return binding;
  },
});
export default {
  async fetch(request: Request, environment: WorkerEnvironment & RunnerWebhookEnvironment, context: ExecutionContext) {
    const runner = await runnerWebhook(request, environment);
    if (runner) return runner;
    const pathname = new URL(request.url).pathname;
    if (pathname === "/demo" || pathname.startsWith("/demo/")) {
      if (!demoRouteAllowed(pathname)) return new Response("Not found", { status: 404 });
      return demo.fetch(await demoAccessRequest(request, environment.EFFECT_CI_API_TOKEN), environment, context);
    }
    if (request.method === "POST" && new URL(request.url).pathname === "/webhooks/slack") {
      const body = await request.clone().text();
      if (body.length > 32_000) return new Response("Payload too large", { status: 413 });
      if (isHmdSlackBody(body)) {
        const binding = (
          context.exports as unknown as { HmdApprovals: DurableObjectNamespace<HmdApprovals> }
        ).HmdApprovals;
        const review = (capability: HmdCapability) => binding.getByName(capability.owner);
        return hmdSlackInteraction(request, environment, {
          inspect: (capability) => review(capability).inspect(capability),
          submit: (capability, decision, reason, actor) =>
            review(capability).submit(capability, decision, reason, actor),
        });
      }
    }
    return ci.fetch(request, environment, context);
  },
};

export const EffectCIWorkflow = GitHubCloudflare.workflowEntrypoint(workflow, {
  slackLayout: "status-thread",
  notificationChannels,
  root: "examples/github-cloudflare-ci",
  container: { image: "workspace", instance: "standard-1" },
});
