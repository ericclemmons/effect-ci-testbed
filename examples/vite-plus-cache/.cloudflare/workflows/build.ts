import * as CI from "@effect-ci-testbed/ci"

import * as actions from "../actions/index.ts"

export default CI.workflow("vite-plus-cache", function* () {
  return yield* actions.build()
})
