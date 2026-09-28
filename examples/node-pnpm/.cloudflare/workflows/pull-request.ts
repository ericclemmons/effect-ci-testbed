import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

import * as actions from "../actions/index.ts"

export default CI.workflow("node-pnpm", function* () {
  return yield* Effect.validate(
    [
      actions.build(),
      actions.lint(),
      actions.test(),
    ],
    (check) => check,
    { concurrency: "unbounded" },
  )
}, { on: ["pull_request", "push"] })
