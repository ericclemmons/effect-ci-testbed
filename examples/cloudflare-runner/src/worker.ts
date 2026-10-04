import * as Cloudflare from "@effect-ci-testbed/cloudflare"

import workflow from "../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export default {
  fetch() {
    return new Response("Effect CI Cloudflare runner")
  },
}

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  root: "examples/cloudflare-runner",
  reuseWorkspace: false,
})
