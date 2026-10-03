#!/usr/bin/env -S node --import tsx

import * as CLI from "@effect-ci-testbed/cli"
import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("cache-policy", function* () {
  return yield* actions.verify()
}, {
  cache: process.env.EFFECT_CI_DISABLE_CACHE === "1"
    ? false
    : {
        key: "custom-build-cache",
        keyFiles: [
          "examples/cache-policy/app/cache-version.txt",
          "examples/cache-policy/app/src/input.txt",
        ],
        paths: ["examples/cache-policy/app/.cache/build"],
      },
})

export * from "./actions.ts"
export default workflow

if (CLI.isMain(import.meta.url)) {
  await CLI.runMain({ actions, workflow })
}
