#!/usr/bin/env -S node --import tsx

import * as CLI from "@effect-ci-testbed/cli"

import * as actions from "../actions/index.ts"
import workflow from "./pull-request.ts"

export * from "../actions/index.ts"
export default workflow

if (CLI.isMain(import.meta.url)) {
  await CLI.runMain({ actions, workflow })
}
