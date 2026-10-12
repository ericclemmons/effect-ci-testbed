import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

// Read-only: never deploys, dispatches, retries, or executes a hostile module locally.
const enabled = process.env.LIVE_DYNAMIC_PROJECT === "1"
const get = (workflow: string, id: string) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", [
  "workflows", "instances", "get", id, "--workflow-name", workflow,
], { encoding: "utf8", timeout: 30_000 }))
const value = (step: { output: unknown }) => typeof step.output === "string" ? JSON.parse(step.output) : step.output

test("recorded native project checks used pinned source and no container commands", { skip: !enabled }, () => {
  const run = get("effect-ci-example-dynamic-project", "coverage-dynamic-project-20261012-3")
  assert.equal(run.status, "complete")
  assert.equal(run.params.revision, "baac78ba496d07baf71e0b8962c935d4aa12abab")
  assert.equal(run.step_count, 3)
  assert.ok(run.output.nodes.every((node: { status: string; commands: unknown[]; secrets: unknown[] }) =>
    node.status === "complete" && node.commands.length === 0 && node.secrets.length === 0))
  const execution = run.steps.find((step: { name: string }) => step.name === "dynamic-worker:project-checks-1")
  assert.equal(execution.attempts.length, 1)
  assert.equal(execution.config.retries.limit, 0)
  assert.deepEqual(value(execution), { runtime: "dynamic-worker", containers: 0, passed: [
    "module behavior", "bindings withheld", "outbound denied", "unknown route",
  ] })
})

test("recorded hosted capability probes rejected escape/output/CPU after module preflight", { skip: !enabled }, () => {
  const run = get("effect-ci-probe-dynamic-boundary", "coverage-dynamic-boundary-20261012-3")
  assert.equal(run.status, "complete")
  assert.equal(run.step_count, 7)
  assert.deepEqual(run.steps.map((step: { name: string }) => step.name), [
    "boundary:network-1", "boundary:bindings-1", "boundary:fresh-globals-1", "boundary:host-filesystem-1",
    "boundary:mismatch-1", "boundary:oversized-1", "boundary:cpu-1",
  ])
  for (const step of run.steps) {
    assert.equal(step.success, true)
    assert.equal(step.attempts.length, 1)
    assert.equal(step.config.retries.limit, 0)
    assert.equal(value(step).containers, 0)
  }
  for (const key of ["mismatch", "oversized", "cpu"]) assert.equal(run.output[key].rejected, true)
  assert.equal(run.output.cpu.modulePreflightPassed, true)
  assert.equal(run.output.cpu.policyCpuMs, 50)
  assert.ok(run.output.cpu.elapsedMs < 4000, "host waiting deadline is not CPU proof")
})
