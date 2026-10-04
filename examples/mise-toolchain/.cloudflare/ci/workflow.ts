#!/usr/bin/env node

import * as CLI from "@effect-ci-testbed/cli"
import * as CI from "@effect-ci-testbed/ci"
import * as LocalContainer from "@effect-ci-testbed/local-container"

import * as actions from "./actions.ts"

const workflow = CI.workflow("mise-toolchain", function* () {
  yield* actions.verifyNode()

  return yield* actions.verifyPython()
})

export const local = () => LocalContainer.makeRunner({
  image: "ghcr.io/jdx/mise:2026.9.11-debian",
})

export * from "./actions.ts"
export default workflow

if (CLI.isMain(import.meta.url)) {
  await CLI.runMain({ actions, local, workflow })
}
