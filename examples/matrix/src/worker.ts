import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import workflow from "../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"
export default { fetch: () => new Response("Effect CI matrix example") }

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  root: "examples/matrix",
  container: { image: "workspace", instance: "standard-1" },
  reuseWorkspace: false,
})
