import * as Effect from "effect/Effect"
import * as CI from "@effect-ci-testbed/ci"
import * as actions from "../actions/index.ts"

export default CI.workflow("node-npm", function* () {
  const repository = yield* actions.checkout()
  const dependencies = yield* actions.install(repository)
  return yield* Effect.all([
    actions.build(dependencies),
    actions.lint(dependencies),
    actions.test(dependencies),
  ], { concurrency: "unbounded" })
}, {
  on: ["pull_request", "push"],
})
