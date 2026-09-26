import assert from "node:assert/strict"
import test from "node:test"
import { greet } from "../src/index.js"

test("greets a person", () => {
  assert.equal(greet("Effect"), "Hello, Effect!")
})
