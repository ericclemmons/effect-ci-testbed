import * as Cloudflare from "@effect-ci-testbed/cloudflare"

import workflow from "../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export default {
  fetch() {
    return new Response("Effect CI package-manager cache example")
  },
}

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  cache: {
    key: "npm-downloads",
    keyFiles: ["examples/package-manager-cache/app/package-lock.json"],
    paths: ["examples/package-manager-cache/app/.effect-ci/cache/npm"],
  },
  root: "examples/package-manager-cache",
  reuseWorkspace: false,
})
