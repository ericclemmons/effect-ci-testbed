import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

export const requested = CI.Condition.event("deploy_hook", "deployment")

const workflow = CI.workflow("deploy-hook", function* () {
  return yield* CI.when(requested, actions.deploy())
})

export default workflow
