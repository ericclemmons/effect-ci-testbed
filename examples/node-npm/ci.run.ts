import workflow from "./ci.workflow.ts"
import * as CI from "@effect-ci-testbed/ci"

const env = process.env.NODE_ENV ?? "development"

if (process.env.DRY_RUN) {
  const plan = await CI.planPromise(workflow, { env })
  console.log(`\n${CI.formatPlan(plan)}`)
} else {
  await CI.runPromise(workflow, { env })
}
