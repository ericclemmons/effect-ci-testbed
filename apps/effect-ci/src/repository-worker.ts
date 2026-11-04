import { commandEnvironment } from "./oidc.ts";
import * as Hosted from "@effect-ci-testbed/github-cloudflare";
import { standaloneContainerOptions, standaloneProgram } from "./standalone-program.ts";
import { projectCapabilities, projectSelection } from "./project-runner.ts";

/** Generic repository runs share the host's authentication, not its demo policy. */
const repository = Hosted.worker({
  remoteTargetDiscovery: "project",
  remoteResult: true,
  remoteAuthentication: ["api-token", "cloudflare-access-identity", "github-oidc", "hosted-workload"],
  workflow: (_environment, context) => {
    const binding = (context?.exports as unknown as {
      RepositoryCIWorkflow?: Workflow<Hosted.WorkflowParameters>;
    } | undefined)?.RepositoryCIWorkflow;
    if (!binding) throw new Error("RepositoryCIWorkflow is not exported");
    return binding;
  },
});

export default {
  async fetch(request: Request, environment: Hosted.WorkerEnvironment, context?: ExecutionContext) {
    return projectCapabilities(request, await repository.fetch(request, environment, context));
  },
};

export const RepositoryCIWorkflow = Hosted.workflowEntrypoint(
  (_environment, parameters) => {
    if (parameters.trigger !== "remote") throw new Error("Repository runs require a remote trigger");
    const project = projectSelection(parameters);
    return standaloneProgram(project?.root ?? ".",
      parameters.targets ?? (parameters.target ? [parameters.target] : []), project?.workflow).workflow;
  },
  {
    remoteGitHubCheckout: true,
    commandEnvironment,
    notificationChannels: () => ({}),
    container: { ...standaloneContainerOptions, image: "repository" },
  },
);
