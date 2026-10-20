import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare";
import { standaloneContainerOptions, standaloneProgram } from "./standalone-program.ts";

export { WorkspaceContainer, GitCheckoutOutbound } from "@effect-ci-testbed/github-cloudflare";

// No demo enrollment, Slack destination, release/repair binding or external
// Worker is imported. The installed App and API token establish the host boundary.
export default GitHubCloudflare.worker({
  // The whole project workflow is discoverable inside the workspace. Do not
  // advertise a guessed fixed target list before reading an authored workflow.
  remoteTargetDiscovery: "project",
  remoteResult: true,
  remoteAuthentication: ["api-token"],
});

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
    slackLayout: "status-thread",
    slackCommandOutput: "failed",
    container: standaloneContainerOptions,
  },
);
