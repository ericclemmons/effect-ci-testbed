import assert from "node:assert/strict"
import test from "node:test"
import { BROKEN_SOURCE, FIXED_SOURCE } from "../../../../packages/github/src/repair.ts"
import { PACKAGE_SOURCE, TEST_SOURCE, verifyLocal } from "../scripts/local-verifier.ts"

test("real owned Node test fails on baseline and passes on the canonical fix", () => {
  const broken = verifyLocal(BROKEN_SOURCE, TEST_SOURCE, PACKAGE_SOURCE)
  assert.equal(broken.passed, false)
  assert.equal(broken.exitCode, 1)
  const fixed = verifyLocal(FIXED_SOURCE, TEST_SOURCE, PACKAGE_SOURCE)
  assert.equal(fixed.passed, true)
  assert.equal(fixed.exitCode, 0)
  assert.notEqual(broken.sourceDigest, fixed.sourceDigest)
})
test("unknown scripts, packages and model code cannot reach Node execution", () => {
  for (const values of [[FIXED_SOURCE + "fetch('https://escape.invalid')", TEST_SOURCE, PACKAGE_SOURCE],
    [FIXED_SOURCE, TEST_SOURCE + "console.log(process.env)", PACKAGE_SOURCE],
    [FIXED_SOURCE, TEST_SOURCE, "{}"]]) assert.throws(() => verifyLocal(values[0]!, values[1]!, values[2]!), /fixture bytes required/)
})
