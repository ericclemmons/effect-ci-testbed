import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("secure-secrets", () => actions.authenticate())

export * from "./actions.ts"
export default workflow
