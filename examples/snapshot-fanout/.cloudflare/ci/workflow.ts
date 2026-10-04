import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("snapshot-fanout", function* () {
  return yield* CI.parallel([
    actions.left(),
    actions.right(),
  ])
})

export * from "./actions.ts"
export default workflow
