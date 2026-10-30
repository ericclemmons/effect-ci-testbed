import assert from "node:assert/strict"
import test from "node:test"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { githubSourceComparison } from "./source-comparison.ts"

const base = "a".repeat(40), head = "b".repeat(40), merge = "c".repeat(40)

test("GitHub selects affected comparisons without workflow-level base configuration", () => {
  assert.deepEqual(githubSourceComparison("push", { before: base, after: head }, head), { base, head })
  assert.deepEqual(githubSourceComparison("pull_request", {
    pull_request: { base: { sha: base }, head: { sha: head }, merge_commit_sha: merge },
  }, head), { base, head, mergeBase: true })
  assert.deepEqual(githubSourceComparison("pull_request", {
    pull_request: { base: { sha: base }, head: { sha: head }, merge_commit_sha: merge },
  }, merge), { base, head: merge })
  assert.deepEqual(githubSourceComparison("merge_group", {
    merge_group: { base_sha: base, head_sha: merge },
  }, merge), { base, head: merge })
})

test("unavailable or mismatched event history cannot select an incomplete diff", () => {
  for (const [type, payload, revision] of [
    ["push", { before: "0".repeat(40), after: head }, head],
    ["push", { before: base, after: "0".repeat(40) }, head],
    ["push", { before: base, after: head }, merge],
    ["merge_group", { merge_group: { base_sha: base, head_sha: head } }, merge],
    ["pull_request", { pull_request: { base: { sha: base }, head: { sha: head } } }, merge],
    ["pull_request", { pull_request: { base: { ref: "main" }, head: { sha: head } } }, head],
    ["workflow_dispatch", { before: base, after: head }, head],
    ["push", null, head],
  ] as const) assert.equal(githubSourceComparison(type, payload, revision), undefined)
})

test("the CLI uses GitHub event metadata for a normal source.changed call", () => {
  const directory = mkdtempSync(join(tmpdir(), "effect-ci-cli-changes-")), root = join(directory, "repo")
  mkdirSync(root)
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).trim()
  const ci = fileURLToPath(new URL("../../ci/src/index.ts", import.meta.url))
  const bin = fileURLToPath(new URL("./effect-ci.ts", import.meta.url))
  try {
    git("init", "--quiet"); git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "Source fixture")
    writeFileSync(join(root, "workflow.ts"), `import * as CI from ${JSON.stringify(ci)};
      const deploy=CI.action<string>('deploy',()=>function*(){return 'deployed'});
      const unchanged=CI.action<string>('unchanged',()=>function*(){return 'unchanged'});
      export default CI.workflow('affected',function*(){const source=yield*CI.Source;
        if(yield*source.changed('website/**'))return yield*deploy();else return yield*unchanged();});`)
    mkdirSync(join(root, "website"))
    writeFileSync(join(root, "website/index.html"), "baseline")
    git("add", "."); git("commit", "--quiet", "-m", "baseline")
    const baseline = git("rev-parse", "HEAD")
    writeFileSync(join(root, "README.md"), "documentation only")
    git("add", "."); git("commit", "--quiet", "-m", "docs")
    const revision = git("rev-parse", "HEAD"), eventPath = join(directory, "event.json")
    const run = (type: string, payload: unknown, expected: string) => {
      writeFileSync(eventPath, JSON.stringify(payload))
      const result = spawnSync(process.execPath, [bin, "run", "--workflow", join(root, "workflow.ts"), "--format=json"], {
        cwd: root, encoding: "utf8", timeout: 15_000, env: { ...process.env, AI_AGENT: "test",
          EFFECT_CI_EVENT: type, GITHUB_EVENT_NAME: type, GITHUB_EVENT_PATH: eventPath,
          EFFECT_CI_REVISION: revision, GITHUB_SHA: revision, EFFECT_CI_BASE_REVISION: "" },
      })
      assert.equal(result.status, 0, result.stderr || result.stdout)
      const output = JSON.parse(result.stdout)
      assert.deepEqual(output.plan.nodes.map((node: { id: string }) => node.id), [expected])
    }
    run("push", { before: baseline, after: revision }, "unchanged")
    run("pull_request", { pull_request: { base: { sha: baseline }, head: { sha: revision } } }, "unchanged")
    run("merge_group", { merge_group: { base_sha: baseline, head_sha: revision } }, "unchanged")
    // No comparison is not an empty comparison: a missing push baseline runs.
    run("push", { before: "0".repeat(40), after: revision }, "deploy")
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
