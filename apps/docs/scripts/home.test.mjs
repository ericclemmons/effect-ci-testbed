import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import { createFactory } from "../src/factory.mjs"

const output = resolve(import.meta.dirname, "../dist")
const homepage = readFileSync(resolve(output, "index.html"), "utf8")

test("the homepage shows the factory before JavaScript loads", () => {
  assert.match(homepage, /id="how-it-works"/)
  for (const node of ["me", "teammate", "a1", "a2", "a3", "github", "runner", "app"]) assert.match(homepage, new RegExp(`data-node="${node}"`))
  assert.match(homepage, /data-pool="worker"/)
  assert.match(homepage, /data-pool="container"/)
  assert.match(homepage, /dash\.cloudflare\.com/)
  assert.match(homepage, /href="\/walkthrough\/"/)
  assert.match(homepage, /href="\/examples\/features\/"/)
  assert.doesNotMatch(homepage, /readiness-table/, "the matrix lives on the features page")
})

test("two minutes of the stream show the team, signed checks, reviews and an agent fix", () => {
  const seen = []
  const factory = createFactory({ onLog: (id, line) => seen.push(`${id}: ${line}`) })
  factory.advance(120_000)
  const { runner, app } = factory.state
  const all = seen.join("\n")
  assert.ok(runner.runs >= 15, `expected a steady stream of runs, got ${runner.runs}`)
  assert.match(all, /a1: \$ effect-ci run --local/, "agents iterate locally")
  assert.match(all, /a\d: \$ effect-ci run check/, "agents check commits on the hosted runner")
  assert.match(all, /a2: Error \[CI_COMMAND_FAILED\]/, "a failing check sends the agent back to fix it")
  assert.match(all, /a\d: \$ gh pr create/, "agents open pull requests")
  assert.match(all, /(me|teammate): \$ gh pr merge \d+/, "people review and merge")
  assert.match(all, /runner: ◉ signed checks for \w+: skip lint, format, build, test/, "main reuses the signed checks")
  assert.match(all, /slot-\d+: \$ cf run deploy/, "main only deploys")
  assert.match(all, /runner: Markdown-only commit: format in a Worker, no containers/)
  assert.ok(app.version > 127, "merges reach production")
  assert.match(all, /runner: → dispatch Agent \d/, "an error dispatches an agent")
  assert.match(all, /github: PR #\d+ fix: /, "the agent opens a fix for review")
  assert.match(all, /app: ✓ 5xx rate back to 0\.0%/)
})
