import assert from "node:assert/strict";
import test from "node:test";
import { showcaseGitHubAllowed, showcaseProductionAllowed, showcaseReleaseRef, showcasePreviewRef, showcaseRunAllowed, showcaseSelection, showcaseRouteAllowed } from "./showcase-policy.ts";

test("only the explicit signed owned release branch can reach showcase rollout", () => {
  const input = { trigger: "github", repository: "https://github.com/ericclemmons/effect-ci-testbed.git",
    repositoryName: "ericclemmons/effect-ci-testbed", installationId: 165265172,
    revision: "a".repeat(40), ref: showcaseReleaseRef };
  assert.equal(showcaseGitHubAllowed(input), true);
  assert.equal(showcaseProductionAllowed(input), true);
  assert.equal(showcaseProductionAllowed({ ...input, trigger: "remote" }), false);
  assert.equal(showcaseGitHubAllowed({ ...input, ref: showcasePreviewRef }), true);
  assert.equal(showcaseProductionAllowed({ ...input, ref: showcasePreviewRef }), false);
  for (const change of [{ repository: "https://github.com/other/repo.git" }, { installationId: 1 },
    { ref: "refs/heads/main" }, { ref: "refs/heads/demo/showcase/other" }, { revision: "main" }]) {
    assert.equal(showcaseGitHubAllowed({ ...input, ...change }), false);
    assert.equal(showcaseProductionAllowed({ ...input, ...change }), false);
  }
  assert.equal(showcaseRunAllowed(input), true);
  assert.deepEqual(showcaseSelection({ targets: ["test", "build"] }), ["test", "build"]);
  assert.throws(() => showcaseSelection({ targets: ["release"] }));
  assert.throws(() => showcaseSelection({ target: "test", targets: ["build"] }));
});

test("the showcase mount has dispatch/read routes but no webhook or approval capability routes", () => {
  for (const path of ["/showcase", "/showcase/", "/showcase/capabilities", "/showcase/runs", "/showcase/runs/id", "/showcase/runs/id/events"])
    assert.equal(showcaseRouteAllowed("https://host.invalid" + path), true);
  for (const path of ["/showcase/webhooks/github", "/showcase/webhooks/slack", "/showcase/runs/id/approvals/anything", "/showcase/runs/id/events/extra", "/showcase-other/runs"])
    assert.equal(showcaseRouteAllowed("https://host.invalid" + path), false);
});
