import * as CI from "@effect-ci-testbed/ci"

import * as actions from "../actions/index.ts"

export default CI.workflow("node-npm deploy", function* () {
  const event = yield* CI.WorkflowEvent

  if (event.type !== "workflow_dispatch") {
    return
  }

  return yield* actions.deploy()
})
