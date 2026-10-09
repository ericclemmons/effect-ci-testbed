import assert from "node:assert/strict"
import { test } from "node:test"

import { assertTaskCacheHit } from "../../../scripts/assert-task-cache-hit.ts"

test("task cache proof reads positioned native build checkpoints", () => {
  for (const output of [
    { stdout: "cache hit, replaying logs" },
    JSON.stringify({ stdout: "cache hit, replaying logs" }),
  ]) {
    assertTaskCacheHit({ status: "complete", steps: [
      { name: 'command:["install",1]-1', output: { stdout: "installed" } },
      { name: 'command:["build",1]-1', output },
      { name: "build:commit-1", output: JSON.stringify({ id: "snapshot" }) },
    ] })
  }
})

test("task cache proof rejects misses, unrelated hits, and incomplete runs", () => {
  assert.throws(() => assertTaskCacheHit({ status: "complete", steps: [
    { name: 'command:["build",1]-1', output: { stdout: "cache miss" } },
    { name: 'command:["install",1]-1', output: { stdout: "cache hit" } },
  ] }), /Expected task cache hit/)
  assert.throws(() => assertTaskCacheHit({ status: "complete", steps: [] }), /Expected task cache hit/)
  assert.throws(() => assertTaskCacheHit({ status: "running", steps: [] }), /Expected completed Workflow/)
})
