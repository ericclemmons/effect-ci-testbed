import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"

const output = resolve(import.meta.dirname, "../dist")
const homepage = readFileSync(resolve(output, "index.html"), "utf8")

test("the homepage explains the run before JavaScript loads", () => {
  assert.match(homepage, /id="how-it-works"/)
  for (const step of ["checkout", "install", "build", "publish"]) assert.match(homepage, new RegExp(`data-node="${step}"`))
  assert.match(homepage, /vp build ○ cache miss: &#39;worker\/index.ts&#39; modified, executing|vp build ○ cache miss: 'worker\/index.ts' modified, executing/)
  assert.match(homepage, /data-node="publish" data-state="waiting"/)
  assert.match(homepage, /href="\/walkthrough\/"/)
  assert.match(homepage, /href="\/examples\/features\/"/)
  assert.doesNotMatch(homepage, /readiness-table/, "the matrix lives on the features page")
})
