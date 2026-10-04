#!/usr/bin/env -S node --import tsx

import * as CLI from "@effect-ci-testbed/cli"
import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("dependency-aware-reruns", function* () {
  yield* CI.parallel([
    actions.lint(),
    CI.optional(actions.format()),
  ])
  yield* actions.test()

  return yield* actions.build()
})

export * from "./actions.ts"
export default workflow

if (CLI.isMain(import.meta.url)) {
  await CLI.runMain({ actions, workflow })
}
