import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import workflow from "../../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export const ExportedActionsWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  root: "examples/exported-actions",
  container: { image: "workspace" },
  reuseWorkspace: false,
})

export default { fetch: () => new Response("Not found", { status: 404 }) }
