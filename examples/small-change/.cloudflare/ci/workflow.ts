import * as CI from "@effect-ci-testbed/ci"
import { approveSmallChanges } from "../../workflow.ts"

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout()
})

// Local preview of the same policy: it reports the decision and writes no GitHub review.
const approve = CI.action("approve small change", () => function* () {
  const workspace = yield* checkout()
  return yield* workspace.exec("echo 'Would approve: no TypeScript, TSX or JSON changes'")
})

export default approveSmallChanges(approve)
