import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare"

import workflow from "./workflow.ts"
import { notificationChannels } from "./notification-policy.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/github-cloudflare"
export { HealthChartRenderer } from "./health-renderer.ts"
export { PrivateSlackImages } from "./private-images.ts"

export default GitHubCloudflare.worker()

export const EffectCIWorkflow = GitHubCloudflare.workflowEntrypoint(workflow, {
  notificationChannels,
  root: "examples/github-cloudflare-ci",
  container: { image: "workspace", instance: "standard-1" },
})
