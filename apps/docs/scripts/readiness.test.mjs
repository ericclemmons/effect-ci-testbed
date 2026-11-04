import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { cellResult, complete, loadReadiness, readSnapshot, snapshotPath, validateSnapshot } from "../src/readiness.mjs"

test("the built homepage contains the completed snapshot without browser requests", async () => {
  const snapshot = await loadReadiness()
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8")
  assert.ok(html.includes(`/commit/${snapshot.sha}`))
  assert.ok(html.includes(`${snapshot.total_count} completed checks`))
  assert.ok(html.includes(`datetime="${snapshot.fetchedAt}"`))
  assert.match(html, /aria-label="Run CI with npm · GitHub Actions: [^"]+">[✓×]<\/a>/)
  assert.doesNotMatch(html, /⏳|data-pending|data-refresh|\/api\/readiness|Loading checks from main|Refreshes every/)
})

test("a superseded commit or denied GitHub read cannot replace the saved snapshot", async () => {
  const before = await readFile(snapshotPath, "utf8")
  const temporary = await mkdtemp(join(tmpdir(), "docs-publication-"))
  const stub = join(temporary, "github.mjs")
  const output = join(temporary, "output")
  const env = { ...process.env, DOCS_READINESS_SHA: "a".repeat(40), GITHUB_TOKEN: "test-only", GITHUB_OUTPUT: output }
  const run = () => spawnSync(process.execPath, ["--import", stub, new URL("./snapshot.mjs", import.meta.url).pathname, "--wait"], { env, encoding: "utf8", timeout: 10_000 })
  try {
    await writeFile(stub, `globalThis.fetch = async () => Response.json({sha: "${"b".repeat(40)}"});`)
    assert.equal(run().status, 0)
    assert.equal(await readFile(output, "utf8"), "ready=false\n")
    assert.equal(await readFile(snapshotPath, "utf8"), before)
    await writeFile(stub, `globalThis.fetch = async url => String(url).endsWith("commits/main") ? Response.json({sha: "${"a".repeat(40)}"}) : Response.json({}, {status: 403});`)
    const denied = run()
    assert.notEqual(denied.status, 0)
    assert.match(denied.stderr, /GitHub readiness read failed \(403\)/)
    assert.equal(await readFile(snapshotPath, "utf8"), before)
    assert.equal(await readFile(output, "utf8"), "ready=false\n")
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test("snapshot collection paginates, rejects pending latest checks and retains failures", async () => {
  const sha = "a".repeat(40)
  const check = (id, status, conclusion) => ({ id, name: "node-npm / github", head_sha: sha, status, conclusion, app: { slug: "github-actions" } })
  const pages = [
    [check(1, "completed", "success"), { ...check(2, "in_progress", null), name: "Publish documentation" }],
    [check(3, "queued", null)],
  ]
  let page = 0
  const read = async path => {
    assert.equal(path, `commits/${sha}/check-runs?filter=latest&per_page=100&page=${page + 1}`)
    return { check_runs: pages[page++], total_count: 3 }
  }
  const pending = await readSnapshot(sha, read)
  assert.equal(page, 2)
  assert.equal(complete(pending), false, "an older pass cannot replace a queued rerun")
  assert.throws(() => validateSnapshot(pending), /complete snapshot/)
  pages[1] = [check(3, "completed", "failure")]
  page = 0
  const finished = validateSnapshot(await readSnapshot(sha, read))
  assert.equal(complete(finished), true, "publication does not require all green")
  const cell = cellResult(finished, ["node-npm / github"], "github-actions")
  assert.equal(cell.passing, false)
  assert.equal(cell.state, "node-npm / github: failure")
  assert.equal(cell.href, "https://github.com/ericclemmons/effect-ci-testbed/runs/3")
  const missing = cellResult(finished, ["absent"], "effect-ci")
  assert.equal(missing.passing, false)
  assert.equal(missing.state, "missing check")
  assert.throws(() => validateSnapshot({ ...finished, sha: "b".repeat(40) }), /complete snapshot/)
  assert.equal(complete({ check_runs: [] }), false)
})
