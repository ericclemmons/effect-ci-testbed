import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import workflow from "../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"
export default { fetch: () => new Response("Effect CI timing-aware-splitting example") }

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  root: "examples/timing-aware-splitting",
  container: { image: "workspace", instance: "standard-1" },
  reuseWorkspace: false,
  cache: {
    key: "timing-history-v1",
    keyFiles: ["examples/timing-aware-splitting/app/scripts/split.mjs"],
    paths: ["examples/timing-aware-splitting/app/timings.json"],
  },
})
