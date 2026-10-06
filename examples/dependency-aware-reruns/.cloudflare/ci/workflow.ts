import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("dependency-aware-reruns", function* () {
  yield* CI.parallel([
    actions.lint(),
    CI.optional(actions.format()),
  ])
  yield* actions.test()

  return yield* actions.build()
})

export default workflow
