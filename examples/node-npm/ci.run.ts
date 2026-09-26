import workflow from "./ci.workflow.ts"
import * as CI from "@effect-ci-testbed/ci"

process.env.NODE_ENV ??= process.env.CI ? "test" : "development"

await CI.runPromise(workflow, {
  env: process.env.NODE_ENV,
  mode: process.env.DRY_RUN ? "plan" : "execute",
})
