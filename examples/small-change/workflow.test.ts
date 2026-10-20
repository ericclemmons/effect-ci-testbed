import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import { approveSmallChanges } from "./workflow.ts"
import { evidence } from "./demo.ts"

test("README-only approval needs no line threshold, author history, checks or AI review", async () => {
  const initial = evidence("README.md")
  let approved = false
  const result = await CI.runPromise(approveSmallChanges({
    read: async () => ({ ...initial, files: [{path:"README.md",additions:10000,deletions:10000}],
      checks: [], experience: {}, review: {...initial.review,complete:false} }),
    approve: async () => { approved = true },
  }), {output:"silent"})
  assert.equal(result.value?.eligible, true)
  assert.equal(approved, true)
})

test("README policy produces an approval action only for eligible exact-head evidence", async () => {
  for (const path of ["README.md", "docs/README.md", "src/app.ts", "package.json", "AGENTS.md", ".github/README.md", "README.md.ts"]) {
    let writes = 0
    const result = await CI.runPromise(approveSmallChanges({ read: async () => evidence(path),
      approve: async (before, decision) => { assert.equal(decision.head, before.head); writes++ } }), { output: "silent" })
    const expected = path === "README.md"
    assert.equal(result.value?.eligible, expected, path)
    assert.equal(writes, expected ? 1 : 0, path)
    assert.equal(result.plan.nodes.some(node => node.id === "approve small change"), expected)
  }
})

test("absence of TypeScript is not sufficient; mixed, unknown, stale and incomplete evidence cannot approve", async () => {
  const initial = evidence("README.md")
  for (const change of [
    { complete: false }, { files: [] }, { draft: true }, { open: false },
    { files: [...initial.files, { path: "package.json", additions: 1, deletions: 0 }] },
    { files: [{ path: "README.md", additions: -1, deletions: 0 }] },
    { files: [...initial.files, ...initial.files] }, { head: "unknown" },
    { files: [...initial.files, { path: "src/renamed.ts", additions: 0, deletions: 0 }] },
  ]) {
    const result = await CI.runPromise(approveSmallChanges({ read: async () => ({ ...initial, ...change }),
      approve: async () => assert.fail("Must not approve") }), { output: "silent" })
    assert.equal(result.value?.eligible, false)
  }
})

test("planning discovers the approval graph without reading or writing GitHub", async () => {
  const result = await CI.runPromise(approveSmallChanges({
    read: async () => assert.fail("No API reads while planning"),
    approve: async () => assert.fail("No approval while planning"),
  }), { mode: "plan", output: "silent" })
  assert.deepEqual(result.plan.nodes.map(node => node.id), ["inspect PR", "is small change", "approve small change"])
})

test("moving evidence aborts before publishing; approval failures are never retried", async () => {
  let reads = 0
  await assert.rejects(CI.runPromise(approveSmallChanges({
    read: async () => ({ ...evidence("README.md"), ...(++reads > 1 ? { head: "c".repeat(40) } : {}) }),
    approve: async () => assert.fail("Stale approval"),
  }), { output: "silent" }), /PR evidence changed/)
  let writes = 0
  await assert.rejects(CI.runPromise(approveSmallChanges({ read: async () => evidence("README.md"),
    approve: async () => { writes++; throw Error("Unknown write acknowledgement") },
  }), { output: "silent" }))
  assert.equal(writes, 1)
})
