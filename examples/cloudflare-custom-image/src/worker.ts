import * as Cloudflare from "@effect-ci-testbed/cloudflare"

import workflow from "../.cloudflare/workflows/build.ts"

export { Sandbox } from "@effect-ci-testbed/cloudflare"

export default {
  fetch() {
    return new Response("Effect CI custom-image runner")
  },
}

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow)
