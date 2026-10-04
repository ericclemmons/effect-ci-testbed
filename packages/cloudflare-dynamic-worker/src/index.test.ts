import * as assert from "node:assert/strict"
import { test } from "node:test"

import { selectExecutionTier } from "./policy.ts"

test("routes declared JavaScript work to a Dynamic Worker", () => {
  assert.deepEqual(selectExecutionTier({
    capabilities: ["javascript"],
    preference: "isolate-first",
  }), {
    tier: "dynamic-worker",
    reason: "all declared capabilities are isolate-safe",
  })
})

test("keeps undeclared, process, filesystem, and native work in a container", () => {
  assert.equal(selectExecutionTier(undefined).tier, "container")
  assert.equal(selectExecutionTier({
    capabilities: ["javascript", "filesystem"],
    preference: "isolate-first",
  }).tier, "container")
  assert.equal(selectExecutionTier({
    capabilities: ["native-binary", "process"],
    preference: "isolate-first",
  }).tier, "container")
})

test("network access must be granted by the runner", () => {
  const requirements = {
    capabilities: ["javascript", "network"],
    preference: "isolate-first",
  } as const

  assert.equal(selectExecutionTier(requirements).tier, "container")
  assert.equal(selectExecutionTier(requirements, { allowNetwork: true }).tier, "dynamic-worker")
})
