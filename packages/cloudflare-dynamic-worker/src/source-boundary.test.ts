import * as assert from "node:assert/strict"
import { test } from "node:test"

import * as CI from "@effect-ci-testbed/ci"

test("Effect CI plans declared capabilities and source transforms", async () => {
  const format = CI.action<CI.SourceTransformResult, []>(
    "dynamic-worker-boundary-test:format",
    () => function* () {
      const event = yield* CI.WorkflowEvent
      return yield* CI.transformSources(event.payload as CI.SourceTransformRequest)
    },
    {
      execution: {
        capabilities: ["javascript"],
        preference: "isolate-first",
      },
    },
  )
  const workflow = CI.workflow("dynamic-worker-boundary-test", function* () {
    return yield* format()
  })
  const result = await CI.runPromise(workflow, {
    event: {
      type: "workflow_dispatch",
      payload: {
        files: { "input.ts": "const value={ok:true}\n" },
        tool: "prettier",
      },
    },
    mode: "plan",
    output: "silent",
  })

  assert.deepEqual(result.plan.nodes[0]?.options.execution, {
    capabilities: ["javascript"],
    preference: "isolate-first",
  })
  assert.deepEqual(result.plan.nodes[0]?.sourceTransforms, [{
    files: ["input.ts"],
    tool: "prettier",
  }])
})
