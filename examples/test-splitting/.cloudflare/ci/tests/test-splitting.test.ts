import { spawnSync } from "node:child_process"
import assert from "node:assert/strict"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
    assert.equal(result.plan.nodes.length, 4)
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


test("the join receives reports when every action has a separate filesystem", async () => {
  const root = setup()
  const directories = new Map<string, string>()
  const directory = (stepId: string) => {
    let target = directories.get(stepId)
    if (!target) {
      target = join(root, `isolated-${directories.size}`)
      cpSync(join(root, "app"), target, { recursive: true })
      directories.set(stepId, target)
    }
    return target
  }
  try {
    const result = await CI.runPromise(workflow, {
      output: "silent",
      source: { checkout: () => Effect.succeed(CI.Workspace.local(root)) },
      executor: { execute: (request) => Effect.sync(() => {
        const result = spawnSync(request.command, { cwd: directory(request.stepId), shell: true, encoding: "utf8" })
        return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
      }) },
      workspaceFileSystem: {
        exists: (_, path, stepId) => Effect.sync(() => existsSync(join(directory(stepId), path))),
        readFile: (_, path, stepId) => Effect.sync(() => readFileSync(join(directory(stepId), path), "utf8")),
      },
    })
    assert.ok(result.plan.nodes.every((node) => node.status === "complete"))
    const joined = directories.get("verify shard reports")!
    const files = [0, 1].flatMap((index) => JSON.parse(readFileSync(join(joined, `reports/shard-${index}.json`), "utf8"))
      .results.map((result: { file: string }) => result.file))
    assert.deepEqual(files.sort(), ["a", "b", "c", "d", "e", "f"].map((name) => `tests/${name}.test.mjs`))
    assert.equal(existsSync(join(root, "app/reports")), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
