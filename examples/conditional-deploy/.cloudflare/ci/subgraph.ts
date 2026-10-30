import * as CI from "@effect-ci-testbed/ci"
import { checkout, preview, release, report } from "./subgraph-actions.ts"

export default CI.workflow("conditional-subgraph", function* () {
  yield* checkout()
  yield* CI.branch("publication", CI.Condition.event("push"), {
    onTrue: release,
    onFalse: preview,
  })
  yield* report()
})
