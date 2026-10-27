import * as CI from "@effect-ci-testbed/ci"
import { aggregate, left, right } from "./actions.ts"

export { left, right } from "./actions.ts"
export { local } from "../../../snapshot-fanout/.cloudflare/ci/local.ts"

export default CI.workflow("automatic-fanout-baseline", function* () {
  yield* CI.parallel([left(), right()])
  yield* aggregate()
})
