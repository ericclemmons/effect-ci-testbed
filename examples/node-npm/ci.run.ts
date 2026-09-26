import workflow from "./ci.workflow.ts"
import * as CI from "@effect-ci-testbed/ci"

process.env.NODE_ENV ??= process.env.CI ? "test" : "development"

if (process.env.DRY_RUN) {
  const plan = await CI.planPromise(workflow, { env: process.env.NODE_ENV })
  console.log(`\n${CI.formatPlan(plan)}`)
} else {
  await CI.runPromise(workflow, { env: process.env.NODE_ENV })
}
