import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import workflow from "../../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export const NodeNpmWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  root: "examples/node-npm",
  container: { image: "workspace" },
})

export default { fetch: () => new Response("Not found", { status: 404 }) }
