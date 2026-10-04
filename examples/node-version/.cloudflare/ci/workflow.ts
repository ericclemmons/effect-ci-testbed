import * as CI from "@effect-ci-testbed/ci"
import * as LocalContainer from "@effect-ci-testbed/local-container"

import * as actions from "./actions.ts"

const workflow = CI.workflow("node-version", function* () {
  return yield* actions.verifyNode()
})

export const local = ({ root }: { readonly root: string }) => LocalContainer.makeRunner({
  image: "ghcr.io/jdx/mise:2026.9.11-debian",
  root,
})

export * from "./actions.ts"
export default workflow
