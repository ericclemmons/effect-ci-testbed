import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("immutable-attempts", function* () {
  yield* CI.parallel([actions.lint(), CI.optional(actions.format())])

  return yield* actions.build()
})

export * from "./actions.ts"
export default workflow
