import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

// Read-only recorded evidence; no dispatch, import, token creation or deployment.
const enabled = process.env.LIVE_STANDALONE_ARTIFACTS === "1"
const get = (id: string) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", [
  "workflows", "instances", "get", id, "--workflow-name", "effect-ci-artifacts-source-checks",
], { encoding: "utf8", timeout: 30_000 }))

test("the independently deployed Artifacts example reads and snapshots binding-backed source", { skip: !enabled }, () => {
  const run = get("coverage-artifacts-standalone-20261012-1")
  assert.equal(run.status, "complete")
  assert.equal(run.versionId, "88285523-ea4a-477c-ac9c-8b8f0334fcd9")
  assert.equal(run.params.repository, "effect-ci-artifacts-focused")
  assert.equal(run.params.revision, "e8faf6e46a9dde90067658d87d128c71796ed8c0")
  assert.deepEqual(run.steps.map((step: { name: string }) => step.name), [
    "source:artifacts-1", "checkout:commit-1", "verify Artifacts source:read-source-txt-1",
  ])
  assert.ok(run.steps.every((step: { success: boolean; attempts: unknown[] }) => step.success && step.attempts.length === 1))
  assert.equal(run.steps[2].output, "source from artifacts\n")
  assert.equal(JSON.parse(run.steps[1].output).id, "08ce9d69-6204-496d-a3ba-5c515a255ae3")
  assert.ok(run.output.nodes.every((node: { status: string; commands: unknown[]; secrets: unknown[] }) =>
    node.status === "complete" && node.commands.length === 0 && node.secrets.length === 0))
})

test("the owned workflow rejects a GitHub URL instead of guessing another provider", { skip: !enabled }, () => {
  const run = get("coverage-artifacts-standalone-reject-20261012-1")
  assert.equal(run.status, "errored")
  assert.equal(run.step_count, 0)
  assert.match(run.error.message, /Artifacts repository name/)
})
