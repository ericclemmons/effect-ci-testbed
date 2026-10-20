import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import * as CI from "./index.ts"
import * as Effect from "effect/Effect"

test("a source query drives an ordinary if/else from an actual committed Git diff", async () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-source-changes-"))
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8" }).trim()
  try {
    git("init", "--quiet")
    git("config", "user.email", "fixture@example.invalid")
    git("config", "user.name", "Source fixture")
    mkdirSync(join(root, "apps/site"), { recursive: true })
    writeFileSync(join(root, "apps/site/index.html"), "before")
    git("add", "."); git("commit", "--quiet", "-m", "baseline")
    const since = git("rev-parse", "HEAD")
    writeFileSync(join(root, "apps/site/index.html"), "after")
    git("add", "."); git("commit", "--quiet", "-m", "site change")

    const deploy = CI.action<string>("deploy", () => function* () { return "deployed" })
    const skip = CI.action<string>("no-deploy", () => function* () { return "unchanged" })
    const workflow = CI.workflow("source-if", function* () {
      const source = yield* CI.Source
      if (yield* source.changed("apps/site/**")) return yield* deploy()
      else return yield* skip()
    })
    const run = await CI.runPromise(workflow, { output: "silent",
      event: { type: "push", comparison: { base: since, head: git("rev-parse", "HEAD") } },
      source: { checkout: () => Effect.succeed(CI.Workspace.local(root)) } })
    assert.equal(run.value, "deployed")
    assert.ok(run.plan.nodes.some(node => node.id === "deploy"))
    assert.ok(!run.plan.nodes.some(node => node.id === "no-deploy"))
    // An unrelated project takes the ordinary else branch; no synthetic gate.
    const other = CI.workflow("other-project", function* () {
      const source = yield* CI.Source
      if (yield* source.changed("apps/api/**")) return yield* deploy()
      else return yield* skip()
    })
    const skipped = await CI.runPromise(other, { output: "silent",
      event: { type: "push", comparison: { base: since, head: git("rev-parse", "HEAD") } },
      source: { checkout: () => Effect.succeed(CI.Workspace.local(root)) } })
    assert.equal(skipped.value, "unchanged")
    assert.deepEqual(skipped.plan.nodes.map(node => node.id), ["no-deploy"])
    git("update-ref", "refs/remotes/origin/main", since)
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
    // Local affected queries use the recorded remote default branch, not a
    // convention that every repository has a branch named main.
    const local = await CI.runPromise(other, { output: "silent", source: {
      reference: { kind: "local", path: root }, checkout: () => Effect.succeed(CI.Workspace.local(root)),
    } })
    assert.equal(local.value, "unchanged")
    const stale = await CI.runPromise(workflow, { output: "silent",
      event: { type: "push", comparison: { base: since, head: since } },
      source: { checkout: () => Effect.succeed(CI.Workspace.local(root)) },
    })
    assert.equal(stale.value, "deployed", "stale event metadata cannot skip changes in the actual checkout")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("deleted paths, both sides of a rename, and unusual Git filenames remain matchable", async () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-source-paths-"))
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8" }).trim()
  try {
    git("init", "--quiet"); git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "Source fixture")
    mkdirSync(join(root, "old")); mkdirSync(join(root, "new"))
    writeFileSync(join(root, "old/original.txt"), "rename me")
    writeFileSync(join(root, "deleted.txt"), "delete me")
    git("add", "."); git("commit", "--quiet", "-m", "baseline")
    const since = git("rev-parse", "HEAD")
    git("mv", "old/original.txt", "new/renamed.txt"); git("rm", "--quiet", "deleted.txt")
    writeFileSync(join(root, "new/line\nbreak.txt"), "newline")
    git("add", "."); git("commit", "--quiet", "-m", "moves")
    const workflow = CI.workflow("paths", function* () {
      const source = yield* CI.Source
      return {
        changes: yield* source.changes({ base: since }),
        old: yield* source.changed("old/**", { base: since }),
        moved: yield* source.changed("new/**", { base: since }),
        newline: yield* source.changed("**/line?break.txt", { base: since }),
        deleted: yield* source.changed("deleted.txt", { base: since }),
      }
    })
    const result = await CI.runPromise(workflow, { output: "silent",
      source: { checkout: () => Effect.succeed(CI.Workspace.local(root)) } })
    assert.deepEqual(result.value, { changes: { status: "known", base: since, head: git("rev-parse", "HEAD"),
      paths: ["deleted.txt", "new/line\nbreak.txt", "new/renamed.txt", "old/original.txt"] },
      old: true, moved: true, newline: true, deleted: true })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("provider changes use portable root-relative globs, not substring matches", async () => {
  const cases: ReadonlyArray<readonly [string | ReadonlyArray<string>, string, boolean]> = [
    ["apps/site/**", "apps/site/index.html", true],
    ["apps/site/**", "other/apps/site/index.html", false],
    ["apps/site/*", "apps/site/nested/index.html", false],
    ["apps/site/**/*.ts", "apps/site/index.ts", true],
    ["apps/site/**/*.ts", "apps/site/deep/index.ts", true],
    ["**/*.ts", "index.ts", true],
    ["**/*.(ts|tsx|json)", "index.ts", true],
    ["**/*.(ts|tsx|json)", "src/Button.tsx", true],
    ["**/*.(ts|tsx|json)", "nested/package.json", true],
    ["**/*.(ts|tsx|json)", "docs/README.md", false],
    ["**/*.(ts|tsx|json)", "index.ts.bak", false],
    ["**", "line\nbreak.txt", true],
    [["apps/site/**", "packages/ui/**"], "packages/ui/button.ts", true],
    ["file?.txt", "file1.txt", true],
    ["file?.txt", "file12.txt", false],
    ["README.md", "READMEXmd", false],
    ["literal+(file).txt", "literal+(file).txt", true],
  ]
  for (const [pattern, path, expected] of cases) {
    const workflow = CI.workflow("globs", function* () {
      return yield* (yield* CI.Source).changed(pattern)
    })
    const result = await CI.runPromise(workflow, { output: "silent", source: {
      checkout: () => Effect.die("a provider diff needs no checkout"),
      changes: () => Effect.succeed({ status: "known", base: "a".repeat(40), head: "b".repeat(40), paths: [path] }),
    } })
    assert.equal(result.value, expected, `${JSON.stringify(pattern)} against ${JSON.stringify(path)}`)
  }
})

test("missing, failed or incomplete comparisons run work; cancellation is not a cache miss", async () => {
  const workflow = CI.workflow("unknown-changes", function* () {
    const source = yield* CI.Source
    return yield* source.changed("apps/site/**")
  })
  const missing = await CI.runPromise(workflow, { output: "silent", source: {
    checkout: () => Effect.die("must not checkout without a baseline"),
  } })
  assert.equal(missing.value, true)
  for (const changes of [
    () => Effect.fail(Error("offline")),
    () => Effect.die(Error("provider defect")),
    () => { throw Error("provider callback throws") },
    () => Effect.succeed({ status: "known", base: "", head: "", paths: [] } as CI.SourceChanges),
    () => Effect.succeed({ status: "known", base: "a".repeat(40), head: "b".repeat(40), paths: ["../site"] } as CI.SourceChanges),
  ]) {
    const result = await CI.runPromise(workflow, { output: "silent", source: {
      checkout: () => Effect.die("provider handles changes"), changes,
    } })
    assert.equal(result.value, true)
  }
  await assert.rejects(CI.runPromise(workflow, { output: "silent", source: {
    checkout: () => Effect.die("provider handles changes"), changes: () => Effect.interrupt,
  } }))
})

test("planning performs no source IO and explicitly reports an unknown branch", async () => {
  const workflow = CI.workflow("plan-changes", function* () {
    const source = yield* CI.Source
    return { changes: yield* source.changes({ base: "main" }), matches: yield* source.changed("apps/site/**") }
  })
  const result = await CI.runPromise(workflow, { output: "silent", mode: "plan", source: {
    checkout: () => Effect.die("plan must not checkout"),
    changes: () => Effect.die("plan must not query a provider"),
  } })
  assert.deepEqual(result.value, { changes: { status: "unknown", reason: "plan" }, matches: true })
  assert.deepEqual(result.plan.nodes, [])
})

test("merge-base and direct comparisons differ after base-branch drift; unavailable baselines run", async () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-source-base-"))
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8" }).trim()
  try {
    git("init", "--quiet"); git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "Source fixture")
    writeFileSync(join(root, "base.txt"), "initial")
    git("add", "."); git("commit", "--quiet", "-m", "baseline")
    const initial = git("rev-parse", "HEAD")
    // Distinct commits on the target base and proposed branch.
    writeFileSync(join(root, "base.txt"), "main drift")
    git("add", "."); git("commit", "--quiet", "-m", "main drift")
    git("branch", "target-base")
    git("checkout", "--quiet", "--detach", initial)
    writeFileSync(join(root, "feature.txt"), "feature")
    git("add", "."); git("commit", "--quiet", "-m", "feature")
    git("config", "diff.relative", "true")
    const workflow = CI.workflow("comparison", function* () {
      const source = yield* CI.Source
      return {
        direct: yield* source.changed("base.txt", { base: "target-base" }),
        branch: yield* source.changed("base.txt", { base: "target-base", mergeBase: true }),
        feature: yield* source.changed("feature.txt", { base: "target-base", mergeBase: true }),
        missing: yield* source.changed("absent/**", { base: "missing-baseline" }),
        quoted: yield* source.changed("absent/**", { base: "not-a-ref'; touch injected; #" }),
      }
    })
    mkdirSync(join(root, "nested"))
    const result = await CI.runPromise(workflow, { output: "silent", source: {
      checkout: () => Effect.succeed(CI.Workspace.local(join(root, "nested"))),
    } })
    assert.deepEqual(result.value, { direct: true, branch: false, feature: true, missing: true, quoted: true })
    assert.equal(existsSync(join(root, "injected")), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a dirty checkout is unknown rather than an empty committed diff", async () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-source-dirty-"))
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8" }).trim()
  try {
    git("init", "--quiet"); git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "Source fixture")
    writeFileSync(join(root, "site.txt"), "before")
    git("add", "."); git("commit", "--quiet", "-m", "baseline")
    const workflow = CI.workflow("dirty", function* () {
      return yield* (yield* CI.Source).changed("site.txt", { base: "HEAD" })
    })
    const options = { output: "silent" as const, source: { checkout: () => Effect.succeed(CI.Workspace.local(root)) } }
    assert.equal((await CI.runPromise(workflow, options)).value, false)
    writeFileSync(join(root, "site.txt"), "after")
    assert.equal((await CI.runPromise(workflow, options)).value, true)
    git("checkout", "--", "site.txt")
    writeFileSync(join(root, "untracked.txt"), "untracked")
    assert.equal((await CI.runPromise(workflow, options)).value, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
