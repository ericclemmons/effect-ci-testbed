import assert from "node:assert/strict";
import test from "node:test";
import { demoGitHubAllowed, demoGitHubRef, demoProductionAllowed, demoRunAllowed } from "./demo-policy.ts";
test("demo push enrollment pins repository, installation and exact revision, with main-only release authority", () => {
  const good = {
    repository: "https://github.com/ericclemmons/effect-ci-testbed.git",
    repositoryName: "ericclemmons/effect-ci-testbed",
    installationId: 165265172,
    ref: demoGitHubRef,
    revision: "a".repeat(40),
  };
  assert.equal(demoGitHubAllowed(good), true);
  assert.equal(demoProductionAllowed(good), true);
  for (const ref of ["refs/heads/demo/live", "refs/heads/codex/rehearsal", "refs/heads/feature/new-ui"]) {
    assert.equal(demoGitHubAllowed({ ...good, ref }), true);
    assert.equal(demoProductionAllowed({ ...good, ref }), false);
  }
  for (const change of [
    { repository: "https://github.com/foreign/repo.git" },
    { repositoryName: "foreign/repo" },
    { installationId: 1 },
    { ref: "refs/tags/main" },
    { ref: "refs/heads/" },
    { ref: "refs/heads/main\n" },
    { revision: "main" },
    { revision: "A".repeat(40) },
  ])
    assert.equal(demoGitHubAllowed({ ...good, ...change }), false);
  const { ref: _ref, ...missingRef } = good;
  assert.equal(demoGitHubAllowed(missingRef), false);
  assert.equal(
    demoRunAllowed({ repository: good.repository, revision: good.revision }),
    true,
    "remote enrollment stays unchanged",
  );
});
