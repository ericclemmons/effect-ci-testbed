import * as Cloudflare from "@effect-ci-testbed/cloudflare"

import workflow from "../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export default {
  fetch() {
    return new Response("Effect CI Vite+ cache example")
  },
}

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  container: { image: "workspace" },
  root: "examples/vite-plus-cache",
  reuseWorkspace: false,
})
