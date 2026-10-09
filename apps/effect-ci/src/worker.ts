import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare"

import workflow from "./workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/github-cloudflare"

export default GitHubCloudflare.worker()

export const EffectCIWorkflow = GitHubCloudflare.workflowEntrypoint(workflow, {
  root: "examples/github-cloudflare-ci",
})
