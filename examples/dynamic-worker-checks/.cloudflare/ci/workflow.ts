import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("dynamic-worker-checks", function* () {
  return yield* actions.format()
})

export default workflow
