import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

export default CI.workflow("turborepo-cache", function* () {
  return yield* actions.build()
}, {
  cache: {
    key: "turbo-task",
    keyFiles: ["examples/turborepo-cache/app/package-lock.json"],
    paths: ["examples/turborepo-cache/app/.turbo/cache"],
  },
})
