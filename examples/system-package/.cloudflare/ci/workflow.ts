#!/usr/bin/env node

import * as CLI from "@effect-ci-testbed/cli"
import * as CI from "@effect-ci-testbed/ci"
import * as LocalContainer from "@effect-ci-testbed/local-container"

import * as actions from "./actions.ts"

const workflow = CI.workflow("system-package", function* () {
  return yield* actions.verifyImageMagick()
})

export const local = () => LocalContainer.makeRunner({ image: "node:24-bookworm-slim" })

export * from "./actions.ts"
export default workflow

if (CLI.isMain(import.meta.url)) {
  await CLI.runMain({ actions, local, workflow })
}
