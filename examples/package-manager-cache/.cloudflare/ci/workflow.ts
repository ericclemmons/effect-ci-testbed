import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

interface Parameters {
  readonly offline?: boolean
}

export default CI.workflow("package-manager-cache", function* () {
  const event = yield* CI.WorkflowEvent
  const parameters = (event.payload ?? {}) as Parameters

  return yield* actions.verify(
    parameters.offline === undefined ? {} : { offline: parameters.offline },
  )
})
