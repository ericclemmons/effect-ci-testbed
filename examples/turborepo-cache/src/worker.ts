import * as Cloudflare from "@effect-ci-testbed/cloudflare"

import workflow from "../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export default {
  fetch() {
    return new Response("Effect CI Turborepo cache example")
  },
}

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  cache: {
    key: "turbo-task",
    keyFiles: ["examples/turborepo-cache/app/package-lock.json"],
    paths: ["examples/turborepo-cache/app/.turbo/cache"],
  },
  root: "examples/turborepo-cache",
  reuseWorkspace: false,
})
