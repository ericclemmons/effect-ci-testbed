import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("exported-actions", () => actions.check())

export { check } from "./actions.ts"
export default workflow
