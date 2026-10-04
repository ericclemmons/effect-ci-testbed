import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

export const production = CI.Condition.all(
  CI.Condition.event("push"),
  CI.Condition.ref("refs/heads/main"),
)

const workflow = CI.workflow("conditional-deploy", function* () {
  return yield* CI.when(production, actions.deploy())
})

export * from "./actions.ts"
export default workflow
