import assert from "node:assert/strict";
import test from "node:test";
import type { HostFinalization } from "@effect-ci-testbed/github-cloudflare";
import { RunCard } from "@effect-ci-testbed/github-cloudflare/run-card";
import { finalizeShowcaseRun } from "./showcase-release.ts";
import { showcaseReleaseRef } from "./showcase-policy.ts";

test("checked previews require a consumed human decision before any candidate or traffic operation", async () => {
  for (const mode of ["reject", "deadline", "forged-event", "approve"] as const) {
    let prepared = 0, closed = 0;
    const posts: string[] = [];
    const revision = "a".repeat(40), digest = "b".repeat(64), snapshot = digest;
    const receipt = { revision, digest, url: `https://effect-ci-demo-site.ericclemmons.workers.dev/r/${revision}/${digest}/index.html` };
    const review = {
      registerShowcaseStart: async () => ({ owner: "owned", phase: 0, snapshot, token: "d".repeat(64) }),
      readShowcaseDecision: async () => {
        if (mode === "forged-event") throw Error("Unconsumed review");
        return { snapshot, decision: mode === "reject" ? "rejected" : "approved", reason: "LOCAL FAKE HUMAN", actor: "slack:T1:U1", acceptedAt: Date.now() };
      },
      close: async () => { closed++; },
    };
    const context = {
      environment: { RELEASE_MANAGER: { prepareCandidate: async (requestedRevision: string, requestedDigest: string) => {
        prepared++;
        assert.equal(requestedRevision, revision);
        assert.equal(requestedDigest, digest);
        throw Error("Stop at candidate boundary");
      } } },
      parameters: { trigger: "github", repository: "https://github.com/ericclemmons/effect-ci-testbed.git", repositoryName: "ericclemmons/effect-ci-testbed",
        installationId: 165265172, revision, ref: showcaseReleaseRef },
      instanceId: "owned", value: receipt,
      card: new RunCard({ instanceId: "owned", repository: "owned/repo", revision }),
      exports: { HmdApprovals: { getByName: () => review }, WorkspaceContainer: { getByName: () => ({ stop: async () => {} }) } },
      step: {
        do: async (_name: string, _config: unknown, body: () => Promise<unknown>) => body(),
        waitForEvent: async () => {
          if (mode === "deadline") throw Error("LOCAL deadline");
          return { payload: { snapshot } };
        },
      },
      publish: async (_key: string, frame: unknown) => { posts.push(JSON.stringify(frame)); },
    } as unknown as HostFinalization<unknown>;
    await assert.rejects(finalizeShowcaseRun(context));
    assert.equal(prepared, mode === "approve" ? 1 : 0);
    assert.ok(closed > 0);
    assert.ok(posts.some(post => post.includes("Start the checked-build rollout")));
    assert.ok(posts.some(post => post.includes("hmd_reject")));
  }
});
