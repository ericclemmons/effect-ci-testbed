import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as CI from "@effect-ci-testbed/ci"
import * as actions from "../actions/index.ts"

export default CI.workflow("node-npm", function* () {
  const repository = yield* actions.checkout()
  const workspace = yield* actions.install(repository)
  const results = yield* Effect.all([
    actions.build(workspace),
    actions.lint(workspace),
    actions.test(workspace),
  ], { concurrency: "unbounded", mode: "result" })

  const failures = results
    .filter(Result.isFailure)
    .map((result) => result.failure)

  if (failures.length > 0) {
    return yield* Effect.fail(new AggregateError(failures, "CI checks failed"))
  }

  return results
}, { on: ["pull_request", "push"] })
