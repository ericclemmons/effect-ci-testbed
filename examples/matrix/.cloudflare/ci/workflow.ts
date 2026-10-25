import * as CI from "@effect-ci-testbed/ci"
import { checks } from "./actions.ts"

export default CI.workflow("matrix", function* () {
  yield* CI.parallel(checks.map((check) => check()))
})
