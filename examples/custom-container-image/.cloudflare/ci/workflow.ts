#!/usr/bin/env node

import * as CLI from "@effect-ci-testbed/cli"
import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("custom-container-image", function* () {
  const event = yield* CI.WorkflowEvent

  if (!["pull_request", "push", "workflow_dispatch"].includes(event.type)) {
    return
  }

  return yield* actions.publishImage()
})

export * from "./actions.ts"
export default workflow

if (CLI.isMain(import.meta.url)) {
  await CLI.runMain({ actions, workflow })
}
