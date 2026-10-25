import { oidc, repositoryRegistry, commandEnvironment } from "./oidc.ts";
import { operatorRemote, workloadRemote, enrollWorkload } from "./remote-identity.ts";
import type { OidcEnvironment } from "./oidc-repositories.ts";
export { TokenLease, OidcRepositories } from "./oidc.ts";
import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare";
import { standaloneContainerOptions, standaloneProgram } from "./standalone-program.ts";

export { WorkspaceContainer, GitCheckoutOutbound } from "@effect-ci-testbed/github-cloudflare";

// No demo enrollment, Slack destination, release/repair binding or external
// Worker is imported. The installed App and API token establish the host boundary.
const ci = GitHubCloudflare.worker({
  // The whole project workflow is discoverable inside the workspace. Do not
  // advertise a guessed fixed target list before reading an authored workflow.
  remoteTargetDiscovery: "project",
  remoteResult: true,
  remoteAuthentication: ["api-token", "cloudflare-access-identity", "github-oidc", "hosted-workload"],
});

export default {
  async fetch(request: Request, environment: GitHubCloudflare.WorkerEnvironment & OidcEnvironment, context: ExecutionContext) {
    const path = new URL(request.url).pathname;
    const forward = (verified: Request, auth: OidcEnvironment) => ci.fetch(verified, { ...environment, ...auth }, context);
    if (path === "/api/oidc/repositories" && request.method === "POST") return enrollWorkload(request, environment, repositoryRegistry(context));
    if (path.startsWith("/api/")) return workloadRemote(request, environment, repositoryRegistry(context), forward);
    if (path === "/oidc/repositories") return operatorRemote(request, environment, (verified, auth) => oidc(verified, { ...environment, ...auth }, context));
    if (["/token", "/revoke"].includes(path)) return oidc(request, environment, context);
    if (path === "/capabilities" || path === "/runs" || path.startsWith("/runs/")) return operatorRemote(request, environment, forward);
    return ci.fetch(request, environment, context);
  },
};

export const EffectCIWorkflow = GitHubCloudflare.workflowEntrypoint(
  (environment, parameters) => {
    const root =
      (environment as unknown as { EFFECT_CI_PROJECT_ROOT?: string }).EFFECT_CI_PROJECT_ROOT ?? ".";
    const targets = parameters.trigger === "remote"
      ? parameters.targets ?? (parameters.target ? [parameters.target] : []) : [];
    return standaloneProgram(root, targets).workflow;
  },
  {
    remoteGitHubCheckout: true,
    commandEnvironment,
    slackLayout: "status-thread",
    slackCommandOutput: "failed",
    container: standaloneContainerOptions,
  },
);
