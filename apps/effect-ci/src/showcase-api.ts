import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare";
import { showcaseRunAllowed, showcaseSelection } from "./showcase-policy.ts";
import { ShowcaseGoal } from "./showcase-protocol.ts";
import type { ShowcaseExecutionAuthority } from "./showcase-execution.ts";
import { showcaseAuthorityName } from "./showcase-runner-policy.ts";

/** The existing hosted showcase API, shared with its native integration tests. */
export const showcaseApi = GitHubCloudflare.worker({
  routePrefix: "/showcase",
  remoteTargets: ShowcaseGoal.literals,
  remoteResult: true,
  remoteRerun: true,
  remoteAuthentication: ["api-token", "cloudflare-access-identity"],
  executionHistory: async (input, _environment, context) => {
    const authority = (context?.exports as unknown as { TrustedDemoChecks?: {
      getByName(name: string): ShowcaseExecutionAuthority;
    } } | undefined)?.TrustedDemoChecks;
    if (!authority) throw Error("Showcase execution history unavailable");
    return authority.getByName(showcaseAuthorityName).executionHistory(input.revision, input.after);
  },
  remoteRunAllowed: input => {
    if (!showcaseRunAllowed(input)) return false;
    try { showcaseSelection(input); return true; } catch { return false; }
  },
  workflow: (_environment, context) => {
    const binding = (context?.exports as unknown as { ShowcaseCIWorkflow?: Workflow<GitHubCloudflare.WorkflowParameters> } | undefined)?.ShowcaseCIWorkflow;
    if (!binding) throw Error("ShowcaseCIWorkflow is not exported");
    return binding;
  },
});
