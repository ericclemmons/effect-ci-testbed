#!/usr/bin/env -S node --import tsx

import * as CLI from "@effect-ci-testbed/cli"
import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

export const production = CI.Condition.all(
  CI.Condition.event("push"),
  CI.Condition.ref("refs/heads/main"),
)

const workflow = CI.workflow("conditional-deploy", function* () {
  return yield* CI.when(production, actions.deploy())
})

export * from "./actions.ts"
export default workflow

if (CLI.isMain(import.meta.url)) {
  await CLI.runMain({ actions, workflow })
}
