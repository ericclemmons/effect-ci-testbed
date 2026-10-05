import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("cache-policy", function* () {
  return yield* actions.verify()
})

export default workflow
