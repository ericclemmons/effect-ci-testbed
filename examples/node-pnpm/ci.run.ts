import workflow from "./ci.workflow.ts"
import * as CI from "@effect-ci-testbed/ci"

const env = process.env.NODE_ENV ?? (process.env.CI ? "test" : "development")

await CI.runPromise(workflow, {
  env,
  mode: process.env.DRY_RUN ? "plan" : "execute",
})
