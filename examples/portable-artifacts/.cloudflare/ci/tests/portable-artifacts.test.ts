import assert from "node:assert/strict"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

import workflow from "../workflow.ts"

const { plan } = await CI.runPromise(workflow, { mode: "plan", output: "silent" })

assert.deepEqual(
  plan.nodes.find((node) => node.id === "publish build")?.artifacts,
  [{ direction: "publish", name: "worker", paths: ["dist/worker.js"] }],
)
assert.deepEqual(
  plan.nodes.find((node) => node.id === "restore build")?.artifacts,
  [{ direction: "restore", name: "worker", paths: ["dist/worker.js"] }],
)

const commands: Array<string> = []
const executed = await CI.runPromise(workflow, {
  executor: {
    execute: ({ command }) => {
      commands.push(command)

      return Effect.succeed({ exitCode: 0, stderr: "", stdout: "" })
    },
  },
  output: "silent",
})

assert.deepEqual(commands, [
  "mkdir -p dist && echo worker > dist/worker.js",
  "test -f dist/worker.js",
])
assert.equal(executed.value.kind, "local")
