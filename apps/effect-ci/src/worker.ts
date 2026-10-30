export { DocsReadiness } from "./docs-readiness.ts";
import { accessIdentityVerifier } from "@effect-ci-testbed/github-cloudflare/access-identity";
import { demoAccessIdentity } from "./demo-access-policy.ts";
const verifyOperatorIdentity = accessIdentityVerifier(demoAccessIdentity);
import { operatorRemote, workloadRemote, enrollWorkload } from "./remote-identity.ts";
import { oidc, repositoryRegistry } from "./oidc.ts";
import type { OidcEnvironment } from "./oidc-repositories.ts";
export { TokenLease, OidcRepositories } from "./oidc.ts";
import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare";
import repository from "./repository-worker.ts";
export { RepositoryCIWorkflow } from "./repository-worker.ts";

import { monorepoGitHubRun } from "./monorepo-policy.ts";
import { showcaseCheckSuiteRun, showcaseGitHubRun, showcaseRouteAllowed } from "./showcase-policy.ts";
import { showcaseApi as showcase } from "./showcase-api.ts";
import { hmdSlackInteraction, isHmdSlackBody } from "./hmd-slack.ts";
import type { HmdApprovals, HmdCapability } from "./hmd-approval.ts";
import type { WorkerEnvironment } from "../../../packages/github-cloudflare/src/worker.ts";
import { demoRouteAllowed, demoRunAllowed, demoRemoteTargets } from "./demo-policy.ts";
import { demoAccessRequest } from "./demo-access.ts";
import { runnerWebhook, type RunnerWebhookEnvironment } from "./runner-webhook.ts";
import { smallChangeWebhook } from "./small-change-webhook.ts";
export { SmallChangeReviews, SmallChangeReviewWorkflow } from "./small-change-review.ts";
export { DemoCIWorkflow } from "./demo-workflow.ts";
export { ShowcaseCIWorkflow } from "./showcase-workflow.ts";
export { TrustedDemoChecks } from "./trusted-demo-checks.ts";
export { StaticAssetSourceReader } from "./static-assets-source.ts";
export { PublicIncidentRepairOperations, PublicIncidentDispatcher, PublicIncidentRepairWorkflow, PublicPipelineReadiness } from "./public-incident-repair.ts";
export { DemoCandidateRecoveryWorkflow } from "./demo-candidate-recovery.ts";
export { DemoRoutingDiagnosticWorkflow } from "./demo-routing-diagnostic-workflow.ts";

export { GitCheckoutOutbound } from "@effect-ci-testbed/github-cloudflare";
export { MonorepoCIWorkflow as EffectCIWorkflow } from "./monorepo-workflow.ts";
export { WorkspaceContainer, CloudflareDeploymentOutbound } from "./monorepo-container.ts";
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
  githubPushRun: showcaseGitHubRun,
  githubRun: (identity, environment, context) =>
    showcaseCheckSuiteRun(identity, environment, context) ?? monorepoGitHubRun(identity, environment, context),
  remoteRunAllowed: () => false,
});
const demo = GitHubCloudflare.worker({
  routePrefix: "/demo",
  remoteTargets: demoRemoteTargets,
  remoteResult: true,
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
  async fetch(request: Request, environment: WorkerEnvironment & RunnerWebhookEnvironment & OidcEnvironment, context: ExecutionContext) {
    const runner = await runnerWebhook(request, environment);
    if (runner) return runner;
    const review = await smallChangeWebhook(request, environment.GITHUB_WEBHOOK_SECRET,
      (context.exports as unknown as { SmallChangeReviewWorkflow: Workflow<{ number: number }> }).SmallChangeReviewWorkflow);
    if (review) return review;
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/oidc/repositories" && request.method === "POST") return enrollWorkload(request, environment, repositoryRegistry(context));
    if (pathname.startsWith("/api/")) return workloadRemote(request, environment, repositoryRegistry(context), (verified, auth) => repository.fetch(verified, { ...environment, ...auth }, context));
    if (pathname === "/oidc/repositories") return operatorRemote(request, environment, (verified, auth) => oidc(verified, { ...environment, ...auth }, context), verifyOperatorIdentity);
    if (["/token", "/revoke"].includes(pathname)) return oidc(request, environment, context);
    if (pathname === "/capabilities" || pathname === "/runs" || pathname.startsWith("/runs/")) {
      return operatorRemote(request, environment, (verified, auth) => repository.fetch(verified, { ...environment, ...auth }, context), verifyOperatorIdentity);
    }
    if (pathname === "/showcase" || pathname.startsWith("/showcase/")) {
      if (!showcaseRouteAllowed(request.url)) return new Response("Not found", { status: 404 });
      return showcase.fetch(await demoAccessRequest(request, environment.EFFECT_CI_API_TOKEN), environment, context);
    }
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
