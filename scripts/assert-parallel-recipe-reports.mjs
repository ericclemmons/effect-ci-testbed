import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const [example, historyFile] = process.argv.slice(2)
assert.ok(["test-splitting", "timing-aware-splitting"].includes(example), "Unknown recipe")
const root = resolve("examples", example, "app")
const { split } = await import(pathToFileURL(resolve(root, "scripts/split.mjs")))
const candidates = readdirSync(resolve(root, "tests"))
  .filter((file) => file.endsWith(".test.mjs"))
  .map((file) => `tests/${file}`).sort()
const history = historyFile ? JSON.parse(readFileSync(resolve(root, historyFile), "utf8")) : {}
const expected = split(candidates, 2, history)
const actual = [0, 1].map((index) => {
  const report = JSON.parse(readFileSync(resolve(root, `reports/shard-${index}.json`), "utf8"))
  assert.equal(report.index, index)
  assert.equal(report.total, 2)
  for (const result of report.results) {
    assert.equal(result.passed, true, result.file)
    assert.ok(Number.isFinite(result.durationMs) && result.durationMs > 0, result.file)
  }
  return report.results.map((result) => result.file)
})
assert.deepEqual(actual.flat().sort(), candidates, "Every candidate must run exactly once")
assert.deepEqual(actual, expected, "Assignments must follow the selected splitting policy")
console.log(`${example}: ${candidates.length} files ran exactly once across two shards; assignments verified`)
