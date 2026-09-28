import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

import * as actions from "../actions/index.ts"

export default CI.workflow("node-pnpm", function* () {
  const event = yield* CI.WorkflowEvent
  if (event.type !== "pull_request" && event.type !== "push" && event.type !== "workflow_dispatch") {
    return
  }

  return yield* Effect.validate(
    [
      actions.build().pipe(Effect.asVoid),
      actions.deploy().pipe(Effect.asVoid),
      actions.lint().pipe(Effect.asVoid),
      actions.test().pipe(Effect.asVoid),
    ],
    (check) => check,
    { concurrency: "unbounded", discard: true },
  )
})
