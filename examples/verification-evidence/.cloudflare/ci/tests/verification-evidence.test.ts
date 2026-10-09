import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { generateKeyPairSync } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as CI from "@effect-ci-testbed/ci"
import { gitNotesCheckCache } from "@effect-ci-testbed/github"
import * as Effect from "effect/Effect"

import workflow from "../workflow.ts"

const repository = mkdtempSync(join(tmpdir(), "effect-ci-evidence-"))
const git = (...args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim()

git("init", "--initial-branch=main")
git("config", "user.name", "Effect CI")
git("config", "user.email", "effect-ci@example.test")
writeFileSync(join(repository, "source.ts"), "export const answer = 42\n")
git("add", "source.ts")
git("commit", "--message", "Add source")

const revision = git("rev-parse", "HEAD")
const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
})
const writer = gitNotesCheckCache({ cwd: repository, privateKey, publicKey })
const verifier = gitNotesCheckCache({ cwd: repository, publicKey })

let executions = 0
const executor: CI.CommandExecutor = {
  execute: () => {
    executions++

    return Effect.succeed({ exitCode: 0, stderr: "", stdout: "" })
  },
}

const run = (checkCache: CI.CheckCache, checkout = repository) => CI.runPromise(workflow, {
  checkCache,
  event: {
    type: "push",
    ref: "refs/heads/main",
    revision,
    source: { kind: "git", repository: "https://example.test/repository.git", revision },
  },
  executor,
  output: "silent",
  source: { checkout: () => Effect.succeed(CI.Workspace.local(checkout)) },
})

await run(writer)
const otherCheckout = join(mkdtempSync(join(tmpdir(), "effect-ci-evidence-clone-")), "checkout")
git("clone", repository, otherCheckout)
const reused = await run(verifier, otherCheckout)

assert.equal(executions, 1)
assert.equal(reused.plan.nodes.find((node) => node.id === "verified lint")?.status, "verified")
assert.match(git("notes", "--ref=effect-ci", "show", revision), /signature/)

// Old HEAD evidence must not skip validation of unstaged or staged edits.
const originalNote = git("notes", "--ref=effect-ci", "show", revision)
writeFileSync(join(repository, "source.ts"), "export const answer = 43\n")
await run(writer)
assert.equal(executions, 2)
assert.equal(git("notes", "--ref=effect-ci", "show", revision), originalNote)
git("add", "source.ts")
await run(verifier)
assert.equal(executions, 3)

writeFileSync(join(otherCheckout, "new-source.ts"), "export const added = true\n")
await run(verifier, otherCheckout)
assert.equal(executions, 4, "untracked source must not reuse a HEAD proof")

writeFileSync(join(repository, "source.ts"), "export const answer = 43\n")
git("add", "source.ts")
git("commit", "--message", "Change source")
const changedRevision = git("rev-parse", "HEAD")

await CI.runPromise(workflow, {
  checkCache: verifier,
  event: {
    type: "push",
    ref: "refs/heads/main",
    revision: changedRevision,
    source: {
      kind: "git",
      repository: "https://example.test/repository.git",
      revision: changedRevision,
    },
  },
  executor,
  output: "silent",
  source: { checkout: () => Effect.succeed(CI.Workspace.local(repository)) },
})

assert.equal(executions, 5)
