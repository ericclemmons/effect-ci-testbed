import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"
import { REPAIR_BASE, REPAIR_PATH, REPAIR_REPOSITORY } from "../../../packages/github/src/repair.ts"

/** Read-only inspection: no model, repository write, check update or dispatch. */
test("retained private repair PR contains only the verified fix and preserves main", { skip: process.env.LIVE_GITHUB_REPAIR !== "1" }, () => {
  const api = (path: string) => JSON.parse(execFileSync("gh", ["api", `repos/${REPAIR_REPOSITORY}/${path}`], {
    encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
  }))
  const commit = "bd9682e5b9ca5f8f696ea8052bd5afd4cd2c0a00"
  const digest = "55efeb6f1f64e6dd6f5db766664c08875c31b292ae79774d62d9a2a1fcde516d"
  const pr = api("pulls/1")
  assert.equal(pr.state, "open", "this proof never authorizes automatic merge")
  assert.equal(pr.merged, false)
  assert.equal(pr.user.id, 334321206)
  assert.equal(pr.user.type, "Bot")
  assert.equal(pr.head.sha, commit)
  assert.equal(pr.head.ref, "codex/repair-friday-repair-20261013-1")
  assert.equal(pr.base.ref, REPAIR_BASE)
  assert.deepEqual(api("pulls/1/files?per_page=100").map((file: any) => file.filename), [REPAIR_PATH])
  assert.equal(api("git/ref/heads/main").object.sha, "ecf13c17597b2718e44509e8850eba1b0b15866d")
  const check = api("check-runs/115491016138")
  assert.equal(check.app.id, 5089816)
  assert.equal(check.head_sha, commit)
  assert.equal(check.status, "completed")
  assert.equal(check.conclusion, "success")
  assert.equal(check.external_id, `owned-repair:friday-repair-20261013-1:${commit}:${digest}`)
  assert.ok(Date.parse(check.completed_at) < Date.parse(pr.created_at), "exact-commit check completes before PR proposal")
  assert.ok(pr.body.includes(`Verified commit: \`${commit}\``))
  assert.ok(pr.body.includes(`Source SHA-256: \`${digest}\``))
  assert.ok(pr.body.includes("github_check_115491016138"))
})
