import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("execution-policy", () => actions.flaky())

export default workflow
