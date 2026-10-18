import * as CI from "@effect-ci-testbed/ci"
import * as actions from "./actions.ts"

export default CI.workflow("conditional-deploy-if", function* () {
  const source = yield* CI.Source

  if (yield* source.changed([
    "examples/conditional-deploy/**",
    "packages/ci/**",
    "pnpm-lock.yaml",
  ])) {
    return yield* actions.deploy()
  } else {
    // This branch has no deployment action or checkout prerequisite.
    return undefined
  }
})
