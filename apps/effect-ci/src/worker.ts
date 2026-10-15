import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare";

import workflow from "./workflow.ts";
import { notificationChannels } from "./notification-policy.ts";
import { hmdSlackInteraction, isHmdSlackBody } from "./hmd-slack.ts";
import type { HmdApprovals, HmdCapability } from "./hmd-approval.ts";
import type { WorkerEnvironment } from "../../../packages/github-cloudflare/src/worker.ts";
import { demoRouteAllowed, demoRunAllowed, demoGitHubAllowed } from "./demo-policy.ts";
export { DemoCIWorkflow } from "./demo-workflow.ts";
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
  githubRun: (identity, _environment, context) => {
    if (!demoGitHubAllowed(identity)) return undefined;
    const workflow = (context?.exports as unknown as { DemoCIWorkflow?: Workflow<GitHubCloudflare.WorkflowParameters> } | undefined)?.DemoCIWorkflow;
    if (!workflow) throw Error("DemoCIWorkflow is not exported");
    return { workflow, detailsUrl: `https://dash.cloudflare.com/0db135ec469e2f216fcea26426f29755/workers/workflows/effect-ci-demo/instance/${encodeURIComponent(identity.deliveryId)}` };
  },
});
const demo = GitHubCloudflare.worker({
  routePrefix: "/demo",
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
  async fetch(request: Request, environment: WorkerEnvironment, context: ExecutionContext) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/demo" || pathname.startsWith("/demo/")) {
      if (!demoRouteAllowed(pathname)) return new Response("Not found", { status: 404 });
      return demo.fetch(request, environment, context);
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
  notificationChannels,
  root: "examples/github-cloudflare-ci",
  container: { image: "workspace", instance: "standard-1" },
});
