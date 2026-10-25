import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import workflow from "../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"
export default { fetch: () => new Response("Effect CI test-splitting example") }

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  root: "examples/test-splitting",
  container: { image: "workspace", instance: "standard-1" },
  reuseWorkspace: false,
})
