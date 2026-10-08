import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

export default CI.workflow("cloudflare-hitl-release", function* () {
  return yield* actions.release()
})
