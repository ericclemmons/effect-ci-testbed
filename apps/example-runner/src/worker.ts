import * as Cloudflare from "@effect-ci-testbed/cloudflare"

import nodeNpm from "../../../examples/node-npm/.cloudflare/ci/workflow.ts"
import nodePnpm from "../../../examples/node-pnpm/.cloudflare/ci/workflow.ts"
import optionalChecks from "../../../examples/optional-checks/.cloudflare/ci/workflow.ts"
import workspace from "../../../examples/cloudflare-runner/.cloudflare/ci/workflow.ts"
import conditionalDeploy from "../../../examples/conditional-deploy/.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

// This test host has no HTTP control plane, credentials, or approval endpoint.
// Only authenticated Cloudflare API callers can create or inspect instances.
export default {
  fetch() {
    return new Response("Not found", { status: 404 })
  },
}

export const NodeNpmWorkflow = Cloudflare.workflowEntrypoint(nodeNpm, {
  root: "examples/node-npm",
})
export const NodePnpmWorkflow = Cloudflare.workflowEntrypoint(nodePnpm, {
  root: "examples/node-pnpm",
  container: {
    instance: "standard-1",
    // Runner bootstrap, equivalent to pnpm/action-setup in the YAML comparison.
    readyCommand: "command -v pnpm >/dev/null || npm install --global pnpm@12.8.1 --fetch-retries=1 --fetch-timeout=30000",
  },
})
export const OptionalChecksWorkflow = Cloudflare.workflowEntrypoint(optionalChecks, {
  root: "examples/optional-checks",
})
export const WorkspaceWorkflow = Cloudflare.workflowEntrypoint(workspace, {
  root: "examples/cloudflare-runner",
})
export const ConditionalDeployWorkflow = Cloudflare.workflowEntrypoint(conditionalDeploy, {
  root: "examples/conditional-deploy",
})
