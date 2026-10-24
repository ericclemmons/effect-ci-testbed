import * as CI from "@effect-ci-testbed/ci"
import { shards, verifyReports } from "./actions.ts"

export default CI.workflow("test-splitting", function* () {
  yield* CI.parallel(shards.map((shard) => shard()))
  yield* verifyReports()
})
