import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import { evidence, smallChangeExample } from "./demo.ts"

const run = (host: Parameters<typeof smallChangeExample>[0], mode: "plan" | "execute" = "execute") => {
  const example = smallChangeExample(host)
  return CI.runPromise(example.workflow, { output: "silent", source: example.source, mode })
}

test("safe changes can receive approval without line thresholds, history, or AI review", async () => {
  const initial = evidence("README.md")
  let approved = false
  const result = await run({
    read: async () => ({ ...initial, files: [{path:"README.md",additions:10000,deletions:10000}],
      checks: [], experience: {}, review: {...initial.review,complete:false} }),
    approve: async () => { approved = true },
  })
  assert.equal(result.value?.eligible, true)
  assert.equal(approved, true)
})

test("the trusted workflow grants the exception only when no TS, TSX or JSON changed", async () => {
  for (const path of ["README.md", "docs/README.md", "src/app.ts", "src/Button.tsx", "package.json", "CHANGELOG.md", "README.md.ts"]) {
    let writes = 0
    const result = await run({ read: async () => evidence(path),
      approve: async (before, decision) => { assert.equal(decision.head, before.head); writes++ } })
    const expected = !/\.(ts|tsx|json)$/.test(path)
    assert.equal(result.value?.eligible === true, expected, path)
    assert.equal(writes, expected ? 1 : 0, path)
    assert.equal(result.plan.nodes.some(node => node.id === "approve small change"), expected)
  }
})

test("unknown, stale, incomplete, mixed and renamed-code diffs leave normal review unchanged", async () => {
  const initial = evidence("README.md")
  for (const change of [
    { complete: false }, { files: [] }, { draft: true }, { open: false },
    { files: [...initial.files, { path: "package.json", additions: 1, deletions: 0 }] },
    { files: [{ path: "README.md", additions: -1, deletions: 0 }] },
    { files: [...initial.files, ...initial.files] }, { head: "unknown" },
    { files: [...initial.files, { path: "src/renamed.ts", additions: 0, deletions: 0 }] },
  ]) {
    const result = await run({ read: async () => ({ ...initial, ...change }),
      approve: async () => assert.fail("Must not approve") })
    assert.equal(result.value, undefined)
    assert.deepEqual(result.plan.nodes, [])
  }
})

test("planning leaves the unknown branch alone without reading or writing GitHub", async () => {
  const result = await run({
    read: async () => assert.fail("No API reads while planning"),
    approve: async () => assert.fail("No approval while planning"),
  }, "plan")
  assert.deepEqual(result.plan.nodes, [])
})

test("moving evidence aborts before publishing; approval failures are never retried", async () => {
  let reads = 0
  await assert.rejects(run({
    read: async () => ({ ...evidence("README.md"), ...(++reads > 1 ? { head: "c".repeat(40) } : {}) }),
    approve: async () => assert.fail("Stale approval"),
  }), /PR evidence changed/)
  let writes = 0
  await assert.rejects(run({ read: async () => evidence("README.md"),
    approve: async () => { writes++; throw Error("Unknown write acknowledgement") },
  }))
  assert.equal(writes, 1)
})
