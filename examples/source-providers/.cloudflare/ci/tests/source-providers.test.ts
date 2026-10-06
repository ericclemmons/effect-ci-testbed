import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import { filesystemSource, gitSource } from "../providers.ts"
import workflow from "../workflow.ts"

const git = (cwd: string, ...args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

test("the same workflow accepts filesystem and Git sources", async () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-source-"))
  const repository = join(root, "repository")
  const clone = join(root, "clone")

  try {
    mkdirSync(repository)
    writeFileSync(join(repository, "source.txt"), "portable source\n")
    git(repository, "init", "--initial-branch=main")
    git(repository, "config", "user.name", "Effect CI")
    git(repository, "config", "user.email", "effect-ci@example.com")
    git(repository, "add", "source.txt")
    git(repository, "commit", "-m", "Add source")
    const revision = git(repository, "rev-parse", "HEAD")

    const filesystem = filesystemSource(repository)
    const fromFilesystem = await CI.runPromise(workflow, {
      output: "silent",
      source: filesystem,
    })
    assert.equal(fromFilesystem.plan.nodes.at(-1)?.status, "complete")
    assert.equal(filesystem.reference?.kind, "local")

    const remoteGit = gitSource({ repository, revision, target: clone })
    const fromGit = await CI.runPromise(workflow, {
      output: "silent",
      source: remoteGit,
    })
    assert.equal(fromGit.plan.nodes.at(-1)?.status, "complete")
    assert.equal(remoteGit.reference?.kind, "git")
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
