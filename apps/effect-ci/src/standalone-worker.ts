import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare";
import { standaloneProgram } from "./standalone-program.ts";

export { WorkspaceContainer, GitCheckoutOutbound } from "@effect-ci-testbed/github-cloudflare";

// No demo enrollment, Slack destination, release/repair binding or external
// Worker is imported. The installed App and API token establish the host boundary.
export default GitHubCloudflare.worker({
  remoteTargets: ["test", "build"],
  remoteResult: true,
  remoteAuthentication: ["api-token"],
});

export const EffectCIWorkflow = GitHubCloudflare.workflowEntrypoint(
  (environment, parameters) => {
    const root =
      (environment as unknown as { EFFECT_CI_PROJECT_ROOT?: string }).EFFECT_CI_PROJECT_ROOT ?? ".";
    return standaloneProgram(
      root,
      parameters.trigger === "remote"
        ? (parameters.targets ?? (parameters.target ? [parameters.target] : undefined))
        : undefined,
    ).workflow;
  },
  {
    slackLayout: "status-thread",
    slackCommandOutput: "failed",
    container: { image: "workspace", instance: "standard-1" },
  },
);
