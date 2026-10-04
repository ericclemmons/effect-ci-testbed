import * as CI from "@effect-ci-testbed/ci"
import * as LocalContainer from "@effect-ci-testbed/local-container"

import * as actions from "./actions.ts"

const workflow = CI.workflow("local-container", function* () {
  yield* actions.verifyContainer()

  return yield* actions.test()
})

export const local = ({ root }: { readonly root: string }) =>
  LocalContainer.makeRunner({ image: "node:24-bookworm", root })

export * from "./actions.ts"
export default workflow
