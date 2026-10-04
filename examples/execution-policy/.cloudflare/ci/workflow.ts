#!/usr/bin/env node

import * as CLI from "@effect-ci-testbed/cli"
import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("execution-policy", () => actions.flaky())

export * from "./actions.ts"
export default workflow

if (CLI.isMain(import.meta.url)) {
  await CLI.runMain({ actions, workflow })
}
