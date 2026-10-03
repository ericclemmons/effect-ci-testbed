import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

export default CI.workflow("hitl-deploy", function* () {
  const event = yield* CI.WorkflowEvent

  if (event.type !== "workflow_dispatch") {
    return
  }

  return yield* actions.deploy()
})
