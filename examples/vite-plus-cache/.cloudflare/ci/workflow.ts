import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

export default CI.workflow("vite-plus-cache", function* () {
  return yield* actions.build()
}, {
  cache: {
    key: "vite-task",
    keyFiles: ["examples/vite-plus-cache/app/package-lock.json"],
    paths: ["examples/vite-plus-cache/app/node_modules/.vite/task-cache"],
  },
})
