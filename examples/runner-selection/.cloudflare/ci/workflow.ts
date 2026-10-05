import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("runner-selection", function* () {
  return yield* actions.test()
})

export default workflow
