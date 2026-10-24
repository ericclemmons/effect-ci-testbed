import { readFileSync, writeFileSync } from "node:fs"

const paths = process.argv.slice(2)
if (paths.length === 0) throw new Error("Supply the reports from one complete run")
const reports = paths.map((path) => JSON.parse(readFileSync(path, "utf8")))
const total = reports[0].total
if (reports.length !== total || reports.some((report) => report.total !== total) ||
    new Set(reports.map((report) => report.index)).size !== total ||
    reports.some((report) => !Number.isInteger(report.index) || report.index < 0 || report.index >= total)) {
  throw new Error("Expected exactly one report for each shard")
}
const timings = {}
for (const report of reports) {
  for (const result of report.results) {
    if (Object.hasOwn(timings, result.file)) throw new Error(`Duplicate candidate: ${result.file}`)
    if (!result.passed || !Number.isFinite(result.durationMs) || result.durationMs <= 0) {
      throw new Error(`Cannot record unsuccessful timing: ${result.file}`)
    }
    timings[result.file] = result.durationMs
  }
}
writeFileSync("timings.json", JSON.stringify(timings, null, 2) + "\n")
console.log(`Recorded timings for ${Object.keys(timings).length} files`)
