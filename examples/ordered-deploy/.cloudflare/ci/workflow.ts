import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("ordered-deploy", function* () {
  return yield* CI.when(
    CI.Condition.event("pull_request", "push", "workflow_dispatch"),
    actions.deploy(),
  )
})

export * from "./actions.ts"
export default workflow
