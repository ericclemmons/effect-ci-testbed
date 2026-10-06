import * as CI from "@effect-ci-testbed/ci"
import * as LocalContainer from "@effect-ci-testbed/local-container"

import * as actions from "./actions.ts"

const workflow = CI.workflow("mise-toolchain", function* () {
  yield* actions.verifyNode()

  return yield* actions.verifyPython()
})

export const local = ({ root }: { readonly root: string }) => LocalContainer.makeRunner({
  image: "ghcr.io/jdx/mise:2026.9.11-debian",
  root,
})

export default workflow
