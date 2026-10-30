import * as CI from "@effect-ci-testbed/ci"
import { makeSnapshotRunner } from "@effect-ci-testbed/local-container/snapshots"
import * as actions from "./actions.ts"

export const local = ({ root }: { readonly root: string }) =>
  makeSnapshotRunner({ root, paths: ["app"] })

export { compare, inspect, restore } from "./actions.ts"

export default CI.workflow("workspace", function* () {
  yield* actions.inspect()
  yield* actions.compare()
  return yield* actions.restore()
})
