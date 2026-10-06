import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("custom-runner-image", function* () {
  return yield* actions.verifyPython()
})

export default workflow
