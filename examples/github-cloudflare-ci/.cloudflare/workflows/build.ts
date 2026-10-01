import * as CI from "@effect-ci-testbed/ci"

import * as actions from "../actions/index.ts"

export default CI.workflow("github-cloudflare-ci", function* () {
  return yield* actions.build()
})
