import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("node-npm", function* () {
  const event = yield* CI.WorkflowEvent

  if (!["pull_request", "push", "workflow_dispatch"].includes(event.type)) {
    return
  }

  yield* actions.lint()
  yield* actions.test()

  return yield* actions.build()
})

export * from "./actions.ts"
export default workflow
