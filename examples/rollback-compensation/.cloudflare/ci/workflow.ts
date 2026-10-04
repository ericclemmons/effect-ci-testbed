import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("rollback-compensation", function* () {
  return yield* actions.deploy()
})

export * from "./actions.ts"
export default workflow
