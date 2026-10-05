import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("portable-artifacts", () => actions.deploy())

export default workflow
