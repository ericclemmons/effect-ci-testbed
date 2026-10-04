import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("optional-checks", function* () {
  return yield* CI.parallel([
    actions.lint(),
    CI.optional(actions.format()),
  ])
})

export * from "./actions.ts"
export default workflow
