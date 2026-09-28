import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

import * as actions from "../actions/index.ts"

export default CI.workflow("node-npm", function* () {
  let workspace = yield* actions.checkout()
  workspace = yield* actions.install(workspace)
  return yield* Effect.validate(
    [
      actions.build(workspace),
      actions.lint(workspace),
      actions.test(workspace),
    ],
    (check) => check,
    { concurrency: "unbounded" },
  )
}, { on: ["pull_request", "push"] })
