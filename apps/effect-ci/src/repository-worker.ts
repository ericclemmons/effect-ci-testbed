import * as Hosted from "@effect-ci-testbed/github-cloudflare";
import { standaloneContainerOptions, standaloneProgram } from "./standalone-program.ts";

/** Generic repository runs share the host's authentication, not its demo policy. */
export default Hosted.worker({
  remoteTargetDiscovery: "project",
  remoteResult: true,
  remoteAuthentication: ["api-token"],
  workflow: (_environment, context) => {
    const binding = (context?.exports as unknown as {
      RepositoryCIWorkflow?: Workflow<Hosted.WorkflowParameters>;
    } | undefined)?.RepositoryCIWorkflow;
    if (!binding) throw new Error("RepositoryCIWorkflow is not exported");
    return binding;
  },
});

export const RepositoryCIWorkflow = Hosted.workflowEntrypoint(
  (_environment, parameters) => {
    if (parameters.trigger !== "remote") throw new Error("Repository runs require a remote trigger");
    return standaloneProgram(".", parameters.targets ?? (parameters.target ? [parameters.target] : [])).workflow;
  },
  {
    remoteGitHubCheckout: true,
    notificationChannels: () => ({}),
    container: { ...standaloneContainerOptions, image: "repository" },
  },
);
