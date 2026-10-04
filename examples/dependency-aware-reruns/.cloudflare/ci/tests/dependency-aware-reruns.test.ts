import assert from "node:assert/strict"
import * as CI from "@effect-ci-testbed/ci"

import workflow from "../workflow.ts"

const { plan } = await CI.runPromise(workflow, {
  mode: "plan",
  output: "silent",
})

assert.deepEqual(CI.planRerun(plan, ["test"]), {
  requested: ["test"],
  rerun: ["test", "build"],
  reuse: ["checkout", "install", "format", "lint"],
})

assert.deepEqual(CI.planRerun(plan, ["install"]), {
  requested: ["install"],
  rerun: ["install", "format", "lint", "test", "build"],
  reuse: ["checkout"],
})

assert.deepEqual(CI.planRerun(plan, ["format"]), {
  requested: ["format"],
  rerun: ["format"],
  reuse: ["checkout", "install", "lint", "test", "build"],
})

assert.throws(
  () => CI.planRerun(plan, ["missing"]),
  (error) => error instanceof CI.WorkflowPlanError &&
    error.message === "Unknown workflow node: missing",
)
