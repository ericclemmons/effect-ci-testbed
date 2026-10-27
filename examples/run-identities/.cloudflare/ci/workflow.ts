import * as CI from "@effect-ci-testbed/ci"
import * as actions from "./actions.ts"

export { reusable, flaky } from "./actions.ts"

export default CI.workflow("run-identities", function* () {
  yield* actions.reusable()
  yield* actions.flaky()
})
