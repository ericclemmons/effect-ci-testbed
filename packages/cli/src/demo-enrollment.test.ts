import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("demo-only edits skip the recipe matrix, not branches with library changes", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/e2e.yml", import.meta.url), "utf8")
  for (const trigger of ["pull_request", "push"]) {
    const section = workflow.split(`  ${trigger}:\n`)[1].split(/\n(?:  \w|\w)/)[0]
    assert.match(section, /paths-ignore:\n\s+- 'examples\/demo\/\*\*'/)
    assert.doesNotMatch(section, /branches-ignore/)
  }
})
