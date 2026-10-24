import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { split } from "../examples/timing-aware-splitting/app/scripts/split.mjs"

const root = resolve(process.argv[2] ?? "examples/parallel-recipes-proof/cloudflare")
const read = (name) => JSON.parse(readFileSync(resolve(root, `${name}.json`), "utf8"))
const matrix = read("matrix-20261024-2")
const deterministic = read("splitting-20261024-1")
const cold = read("timing-cold-20261024-1")
const warm = read("timing-warm-20261024-1")
const source = "98a3452d3ff55dc0980b3331df13b55dacd2655a"
const decode = (value) => typeof value === "string" ? JSON.parse(value) : value
const reports = (run) => run.steps.filter((step) => step.name.startsWith("file:") && step.name.includes('"read"'))
  .map((step) => decode(step.output)).sort((a, b) => a.index - b.index)
const expectedFiles = ["a", "b", "c", "d", "e", "f"].map((name) => `tests/${name}.test.mjs`)
const commands = (run) => run.steps.filter((step) => step.name.startsWith("command:"))
  .map((step) => decode(step.output))

for (const run of [matrix, deterministic, cold, warm]) {
  assert.equal(run.status, "complete", run.id)
  assert.equal(run.success, true, run.id)
  assert.equal(run.params.revision, source, run.id)
  assert.equal(run.params.repository, "https://github.com/ericclemmons/effect-ci-testbed.git")
  assert.ok(run.steps.every((step) => step.success === true), run.id)
  assert.ok(run.output.nodes.every((node) => node.status === "complete"), run.id)
  assert.ok(commands(run).every((result) => result.exitCode === 0), run.id)
}
assert.deepEqual(matrix.output.nodes.filter((node) => node.id !== "checkout").map((node) => node.id).sort(), [
  "test de-DE EUR", "test de-DE USD", "test en-US EUR", "test en-US USD",
])
for (const run of [deterministic, cold, warm]) {
  const shards = reports(run)
  assert.equal(shards.length, 2, run.id)
  assert.deepEqual(shards.map((shard) => shard.index), [0, 1])
  assert.ok(shards.every((shard) => shard.total === 2))
  assert.deepEqual(shards.flatMap((shard) => shard.results.map((result) => result.file)).sort(), expectedFiles, run.id)
  assert.ok(shards.every((shard) => shard.results.every((result) => result.passed && result.durationMs > 0)))
}
assert.ok(commands(deterministic).some((result) => result.stdout.includes("Verified 6 tests exactly once")))
const coldReports = reports(cold)
assert.ok(coldReports.every((report) => Object.keys(report.history).length === 0))
const measured = Object.fromEntries(coldReports.flatMap((report) => report.results.map((result) => [result.file, result.durationMs])))
const warmReports = reports(warm)
assert.ok(warmReports.every((report) => JSON.stringify(report.history) === JSON.stringify(measured)))
assert.deepEqual(warmReports.map((report) => report.results.map((result) => result.file)), split(expectedFiles, 2, measured))
assert.ok(warm.steps.some((step) => step.name === "workspace-cache:materialize-1" && step.success))
assert.ok([cold, warm].every((run) => run.steps.some((step) => step.name === "record timings:cache-1" && step.success)))
console.log("Cloudflare verified: four matrix combinations, complete isolated test shards, and exact cross-instance timing-history reuse")
