import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"

import workflow from "./workflow.ts"

const plan = (target?: string) => CI.runPromise(workflow, {
  mode: "plan",
  output: "silent",
  event: { type: "workflow_dispatch", payload: { target } },
})

test("default hosted runs build without requesting approval", async () => {
  const result = await plan()

  assert.deepEqual(result.plan.nodes.map((node) => node.id), ["checkout", "install", "build"])
  assert.equal(result.plan.nodes.some((node) => node.approval), false)
})

test("release requires build and approval; deployment remains echo-only", async () => {
  const result = await plan("release")
  const release = result.plan.nodes.find((node) => node.id === "release")!

  assert.deepEqual(release.dependencies, ["build"])
  assert.ok(release.approval)
  assert.deepEqual(release.commands.map((command) => command.command), ["echo npx cf deploy --prebuilt --mode production"])
})

test("unknown remote targets are rejected instead of silently running build", async () => {
  await assert.rejects(plan("unknown"), /Unknown hosted target/)
})
