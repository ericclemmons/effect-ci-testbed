import type { WorkerEnvironment, WorkflowParameters } from "@effect-ci-testbed/github-cloudflare"

/** One explicit notification/HITL demo; routine webhook and remote builds stay quiet. */
export const notificationChannels = (environment: WorkerEnvironment, parameters: WorkflowParameters) =>
  parameters.trigger === "remote" && parameters.target === "release" ? environment : {}
