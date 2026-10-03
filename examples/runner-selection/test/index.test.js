import assert from "node:assert/strict"
import test from "node:test"
import { runner } from "../src/index.js"

test("runs on the selected compute", () => {
  assert.equal(runner(), "selected by GitHub")
})
