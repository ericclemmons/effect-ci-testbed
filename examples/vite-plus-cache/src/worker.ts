import * as Cloudflare from "@effect-ci-testbed/cloudflare"

import workflow from "../.cloudflare/workflows/build.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export default {
  fetch() {
    return new Response("Effect CI Vite+ cache example")
  },
}

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  cacheKey: "vite-plus-cache",
  cachePaths: ["node_modules/.vite/task-cache"],
  reuseWorkspace: false,
})
