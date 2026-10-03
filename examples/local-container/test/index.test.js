import assert from "node:assert/strict"
import test from "node:test"
import { runtime } from "../src/index.js"

test("runs on Linux", () => {
  assert.equal(runtime(), "linux")
})
