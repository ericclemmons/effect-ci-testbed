import assert from "node:assert/strict"
import test from "node:test"
import { gitlabRepository, gitlabRevision, isPinnedGitlabSource } from "./gitlab-source-reference.ts"

test("public GitLab lab pins both source and revision before credentials or checkout", () => {
  assert.equal(isPinnedGitlabSource({ repository: gitlabRepository, revision: gitlabRevision }), true)
  for (const value of [null, {}, { repository: gitlabRepository, revision: "master" },
    { repository: gitlabRepository, revision: "0".repeat(40) },
    { repository: `${gitlabRepository}?token=untrusted`, revision: gitlabRevision },
    { repository: "https://github.com/example/other.git", revision: gitlabRevision }]) {
    assert.equal(isPinnedGitlabSource(value), false)
  }
})
