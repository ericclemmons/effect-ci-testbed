import assert from "node:assert/strict"
import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { split } from "./split.mjs"

const reports = JSON.parse(process.argv[2])
const candidates = readdirSync("tests").filter((file) => file.endsWith(".test.mjs")).map((file) => `tests/${file}`).sort()
assert.equal(reports.length, 2)
assert.deepEqual(reports.map((report) => report.index).sort(), [0, 1])
const expected = split(candidates, 2)
for (const report of reports) {
  assert.equal(report.total, 2)
  assert.deepEqual(report.results.map((result) => result.file), expected[report.index])
  assert.ok(report.results.every((result) => result.passed && Number.isFinite(result.durationMs) && result.durationMs > 0))
}
assert.deepEqual(reports.flatMap((report) => report.results.map((result) => result.file)).sort(), candidates)
mkdirSync("reports", { recursive: true })
for (const report of reports) writeFileSync(`reports/shard-${report.index}.json`, JSON.stringify(report, null, 2) + "\n")
console.log(`Verified ${candidates.length} tests exactly once across two isolated shards`)
