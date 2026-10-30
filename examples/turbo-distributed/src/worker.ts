import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import workflow from "../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  container: { image: "workspace" },
  root: "examples/turbo-distributed",
  reuseWorkspace: false,
})

export default {
  fetch() {
    return new Response("Effect CI native Turbo graph fan-out prototype")
  },
}
