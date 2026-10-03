import * as Cloudflare from "@effect-ci-testbed/cloudflare"

import workflow from "../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export default {
  fetch() {
    return new Response("Effect CI package-manager cache example")
  },
}

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  cacheKey: "package-manager-cache",
  cachePaths: [".effect-ci/cache/npm"],
  reuseWorkspace: false,
})
