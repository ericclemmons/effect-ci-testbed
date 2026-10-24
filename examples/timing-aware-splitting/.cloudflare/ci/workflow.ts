import * as CI from "@effect-ci-testbed/ci"
import { shards, recordTimings } from "./actions.ts"

export default CI.workflow("timing-aware-splitting", function* () {
  yield* CI.parallel(shards.map((shard) => shard()))
  yield* recordTimings()
})
