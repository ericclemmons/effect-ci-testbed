import assert from "node:assert/strict"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import workflow from "../workflow.ts"

const fixture = new URL("../../../app/", import.meta.url)
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-recipe-"))
  cpSync(fixture, join(root, "app"), { recursive: true, filter: (path) => !path.endsWith("reports") && !path.endsWith("timings.json") })
  return root
}

test("the full workflow executes its real commands", async () => {
  const root = setup()
  let checkouts = 0
  try {
    const result = await CI.runPromise(workflow, {
      output: "silent",
      source: { checkout: () => Effect.sync(() => {
        checkouts++
        return CI.Workspace.local(root)
      }) },
    })
    assert.equal(checkouts, 1)
    assert.ok(result.plan.nodes.every((node) => node.status === "complete"))
    assert.equal(result.plan.nodes.length, 5)
    assert.deepEqual(result.plan.nodes.filter((node) => node.id !== "checkout").map((node) => node.id).sort(), [
      "test de-DE EUR", "test de-DE USD", "test en-US EUR", "test en-US USD",
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a failing branch fails the workflow", async () => {
  const root = setup()
  try {
    writeFileSync(join(root, "app/verify.mjs"), readFileSync(new URL("verify.mjs", fixture), "utf8").replace("process.env.FAIL_COMBINATION", '"en-US USD"'))
    await assert.rejects(CI.runPromise(workflow, {
      output: "silent",
      source: { checkout: () => Effect.succeed(CI.Workspace.local(root)) },
    }))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
