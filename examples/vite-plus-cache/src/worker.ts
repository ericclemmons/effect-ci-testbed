import * as Cloudflare from "@effect-ci-testbed/cloudflare"

import workflow from "../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export default {
  fetch() {
    return new Response("Effect CI Vite+ cache example")
  },
}

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  cache: {
    key: "vite-task",
    keyFiles: ["examples/vite-plus-cache/app/package-lock.json"],
    paths: ["examples/vite-plus-cache/app/node_modules/.vite/task-cache"],
  },
  root: "examples/vite-plus-cache",
  reuseWorkspace: false,
})
