import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("ordered-deploy", function* () {
  const event = yield* CI.WorkflowEvent

  if (!["pull_request", "push", "workflow_dispatch"].includes(event.type)) {
    return
  }

  return yield* actions.deployFrontend()
})

export * from "./actions.ts"
export default workflow
