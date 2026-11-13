import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { generateKeyPairSync } from "node:crypto"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as CI from "@effect-ci-testbed/ci"
import { inputEvidenceCheckCache } from "@effect-ci-testbed/github"
import * as Effect from "effect/Effect"

import workflow from "../inputs.ts"

// A pass survives a squash: the evidence names what the check read, not a commit.
const repository = mkdtempSync(join(tmpdir(), "effect-ci-input-evidence-"))
const git = (cwd: string, ...args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()

git(repository, "init", "--initial-branch=main")
git(repository, "config", "user.name", "Effect CI")
git(repository, "config", "user.email", "effect-ci@example.test")
mkdirSync(join(repository, "app"))
writeFileSync(join(repository, "package.json"), JSON.stringify({
  name: "input-evidence", private: true, type: "module", scripts: { lint: "node --check app/index.js" },
}))
writeFileSync(join(repository, ".gitignore"), "node_modules/\n")
writeFileSync(join(repository, "app/index.js"), "export const answer = 42\n")
writeFileSync(join(repository, "README.md"), "# App\n")
git(repository, "add", ".")
git(repository, "commit", "--message", "Add app")

const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
})

const run = async (checkout: string, checkCache: CI.CheckCache) => {
  const revision = git(checkout, "rev-parse", "HEAD")
  const result = await CI.runPromise(workflow, {
    checkCache,
    event: {
      type: "push",
      ref: "refs/heads/main",
      revision,
      source: { kind: "git", repository: "https://example.test/repository.git", revision },
    },
    output: "silent",
    source: { checkout: () => Effect.succeed(CI.Workspace.local(checkout)) },
  })
  return result.plan.nodes.find((node) => node.id === "squash-safe lint")?.status
}

// A trusted writer runs the check on main and signs what Vite+ traced.
assert.equal(await run(repository, inputEvidenceCheckCache({ cwd: repository, privateKey, publicKey })), "complete")

// Squash a docs edit into a new root commit: a different revision with different history.
writeFileSync(join(repository, "README.md"), "# App\n\nDocs only.\n")
git(repository, "add", "README.md")
git(repository, "commit", "--message", "docs: Explain the app")
git(repository, "reset", "--soft", git(repository, "rev-list", "--max-parents=0", "HEAD"))
git(repository, "commit", "--amend", "--message", "Add app (squashed)")

// A fresh clone has no Vite+ cache. It fetches only the signed evidence.
const clone = join(mkdtempSync(join(tmpdir(), "effect-ci-input-evidence-clone-")), "checkout")
git(repository, "clone", "--quiet", repository, clone)
git(clone, "fetch", "--quiet", "origin", "refs/notes/effect-ci-inputs:refs/notes/effect-ci-inputs")
const reader = inputEvidenceCheckCache({ cwd: clone, publicKey })

assert.equal(await run(clone, reader), "verified", "an unchanged input set reuses the signed pass")

writeFileSync(join(clone, "app/index.js"), "export const answer = 43\n")
assert.equal(await run(clone, reader), "complete", "a changed input runs the check")

// Evidence from another key never counts.
const other = generateKeyPairSync("ed25519", { publicKeyEncoding: { format: "pem", type: "spki" } })
writeFileSync(join(clone, "app/index.js"), "export const answer = 42\n")
assert.equal(await run(clone, inputEvidenceCheckCache({ cwd: clone, publicKey: other.publicKey })), "complete")
