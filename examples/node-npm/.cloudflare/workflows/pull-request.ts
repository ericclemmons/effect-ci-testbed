import * as CI from "@effect-ci-testbed/ci"

import * as actions from "../actions/index.ts"

export default CI.workflow("node-npm", function* () {
  const event = yield* CI.WorkflowEvent
  if (!["pull_request", "push", "workflow_dispatch"].includes(event.type)) {
    return
  }

  yield* actions.lint()
  yield* actions.test()
  yield* actions.build()
  return yield* actions.deploy()
})
