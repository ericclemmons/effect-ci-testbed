import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("tutorial edits retain normal recipe matrix coverage", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/e2e.yml", import.meta.url), "utf8")
  for (const trigger of ["pull_request", "push"]) {
    const section = workflow.split(`  ${trigger}:\n`)[1].split(/\n(?:  \w|\w)/)[0]
    assert.doesNotMatch(section, /paths-ignore/)
    assert.doesNotMatch(section, /branches-ignore/)
  }
})
