import * as CI from "@effect-ci-testbed/ci"

import * as actions from "./actions.ts"

const workflow = CI.workflow("docker-in-docker", () => actions.runImage())

export default workflow
