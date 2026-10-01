import * as Cloudflare from "@effect-ci-testbed/cloudflare"

import workflow from "../.cloudflare/workflows/build.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export default {
  fetch() {
    return new Response("Effect CI Turborepo cache example")
  },
}

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  cacheKey: "turborepo-cache",
  cachePaths: ["examples/turborepo-cache/app/.turbo/cache"],
  reuseWorkspace: false,
})
