import assert from "node:assert/strict"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import workflow from "../workflow.ts"
import { split } from "../../../app/scripts/split.mjs"

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
    assert.equal(result.plan.nodes.length, 3)
    const reports = [0, 1].map((index) => JSON.parse(readFileSync(join(root, `app/reports/shard-${index}.json`), "utf8")))
    const files = reports.flatMap((report) => report.results.map((result: { file: string; passed: boolean }) => {
      assert.equal(result.passed, true)
      return result.file
    }))
    assert.deepEqual(files.sort(), ["a", "b", "c", "d", "e", "f"].map((name) => `tests/${name}.test.mjs`))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a failing branch fails the workflow", async () => {
  const root = setup()
  try {
    writeFileSync(join(root, "app/tests/a.test.mjs"), 'throw new Error("Intentional shard failure")\n')
    await assert.rejects(CI.runPromise(workflow, {
      output: "silent",
      source: { checkout: () => Effect.succeed(CI.Workspace.local(root)) },
    }))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("partitioning has no omissions or duplicates, including empty shards", () => {
  const files = ["f", "a", "e", "b", "d", "c"]
  for (const total of [1, 2, 3, 8]) {
    const result = split(files, total)
    assert.equal(result.length, total)
    assert.deepEqual(result.flat().sort(), [...files].sort())
    assert.deepEqual(result, split([...files].reverse(), total))
  }
  assert.throws(() => split(files, 0))
})

test("round-robin splitting does not depend on timing history", () => {
  assert.deepEqual(split(["f", "e", "d", "c", "b", "a"], 2), [["a", "c", "e"], ["b", "d", "f"]])
})
