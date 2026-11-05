import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("workers-deploy", function* () {
  return yield* CI.when(
    CI.Condition.event("pull_request", "push", "workflow_dispatch"),
    actions.deploy(),
  )
})

export default workflow
