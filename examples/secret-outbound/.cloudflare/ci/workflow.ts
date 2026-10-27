import * as CI from "@effect-ci-testbed/ci"
import * as actions from "./actions.ts"

export { local } from "./local.ts"

export default CI.workflow("secret-outbound", () => actions.authenticate())
