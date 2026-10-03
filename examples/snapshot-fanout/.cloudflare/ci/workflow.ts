#!/usr/bin/env -S node --import tsx

import * as CLI from "@effect-ci-testbed/cli"
import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("snapshot-fanout", function* () {
  return yield* CI.parallel([
    actions.left(),
    actions.right(),
  ])
})

export * from "./actions.ts"
export default workflow

if (CLI.isMain(import.meta.url)) {
  await CLI.runMain({ actions, workflow })
}
