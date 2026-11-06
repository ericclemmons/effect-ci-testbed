import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import { featureEvidence, features, featureStatus } from "../src/features.mjs"

const page = readFileSync(resolve(import.meta.dirname, "../dist/examples/features/index.html"), "utf8")

test("the features page answers whether Effect CI is ready, one row per feature", () => {
  assert.match(page, /id="features-title"[^>]*>Is Effect CI ready yet\?/)
  assert.match(page, /class="answer"[^>]*>(Yes|Not yet)</)
  assert.match(page, new RegExp(`\\d+ of ${features.length} features green`))
  for (const feature of features) assert.match(page, new RegExp(`data-feature="${feature.title}" data-color="(green|red|gray)"`))
  assert.ok(page.indexOf('id="features-title"') < page.indexOf('id="readiness-title"'), "features come before the recipe matrix")
})

test("a feature is red until a check passes, and red again when one fails", () => {
  const sha = "a".repeat(40)
  const run = (name, conclusion) => ({ id: 1, name, head_sha: sha, status: "completed", conclusion, app: { slug: "github-actions" } })
  const feature = { title: "Example", recipes: ["node-npm"] }
  const rows = [{ recipe: "node-npm", cells: [true, false, false, false, false] }]
  const status = check_runs => featureStatus(featureEvidence(feature, { sha, check_runs }, rows)).color
  assert.equal(featureStatus(featureEvidence({ title: "Unproven", recipes: [] }, { sha, check_runs: [] }, rows)).color, "red")
  assert.equal(status([]), "gray")
  assert.equal(status([run("node-npm / github", "success")]), "green")
  assert.equal(status([run("node-npm / github", "failure")]), "red")
  assert.equal(featureStatus(featureEvidence({ title: "Named", recipes: [], checks: ["agent-first executable CI"] },
    { sha, check_runs: [run("agent-first executable CI", "success")] }, rows)).color, "green")
})
