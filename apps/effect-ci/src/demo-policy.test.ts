import assert from "node:assert/strict";
import test from "node:test";
import { demoGitHubAllowed, demoGitHubRef, demoRunAllowed } from "./demo-policy.ts";
test("demo push enrollment pins repository, installation, branch and exact revision independently", () => {
  const good = {
    repository: "https://github.com/ericclemmons/effect-ci-testbed.git",
    repositoryName: "ericclemmons/effect-ci-testbed",
    installationId: 165265172,
    ref: demoGitHubRef,
    revision: "a".repeat(40),
  };
  assert.equal(demoGitHubAllowed(good), true);
  for (const change of [
    { repository: "https://github.com/foreign/repo.git" },
    { repositoryName: "foreign/repo" },
    { installationId: 1 },
    { ref: "refs/heads/main" },
    { ref: "refs/heads/demo/live-extra" },
    { revision: "main" },
    { revision: "A".repeat(40) },
  ])
    assert.equal(demoGitHubAllowed({ ...good, ...change }), false);
  assert.equal(
    demoRunAllowed({ repository: good.repository, revision: good.revision }),
    true,
    "remote enrollment stays unchanged",
  );
});
