import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { performance } from "node:perf_hooks"
import { split } from "./split.mjs"

const [index, total] = process.argv.slice(2).map(Number)
if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) {
  throw new Error("Usage: node scripts/run-shard.mjs INDEX TOTAL (zero-based index)")
}
const candidates = readdirSync("tests").filter((file) => file.endsWith(".test.mjs")).map((file) => `tests/${file}`)
if (candidates.length === 0) throw new Error("No test candidates found")
const timings = existsSync("timings.json") ? JSON.parse(readFileSync("timings.json", "utf8")) : {}
const selected = split(candidates, total, timings)[index]
// Keep nested node:test executions independent of a parent test harness.
const env = { ...process.env }
delete env.NODE_TEST_CONTEXT
const results = []
for (const file of selected) {
  const start = performance.now()
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", file], { encoding: "utf8", env })
  process.stdout.write(result.stdout ?? "")
  process.stderr.write(result.stderr ?? "")
  if (result.error) console.error(result.error)
  results.push({ file, durationMs: performance.now() - start, passed: result.status === 0 })
}
// Empty shards run nothing, rather than accidentally running the whole suite.
mkdirSync("reports", { recursive: true })
writeFileSync(`reports/shard-${index}.json`, JSON.stringify({ index, total, history: timings, results }, null, 2) + "\n")
console.log(`SHARD ${index}/${total}: ${selected.join(", ") || "(empty)"}`)
process.exitCode = results.every((result) => result.passed) ? 0 : 1
