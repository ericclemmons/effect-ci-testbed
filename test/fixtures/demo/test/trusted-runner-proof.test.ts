import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { webcrypto as crypto } from "node:crypto";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
import { verifyRunnerCheckReceipt } from "../../../../packages/cloudflare/src/runner-check-receipt.ts";
import { verifyRunnerStepReceipt } from "../../../../packages/cloudflare/src/runner-step-result.ts";
import {
  demoBuildIdentity,
  demoRunnerPolicyDigest,
} from "../../../../apps/effect-ci/src/demo-runner-policy.ts";
import { testCommand } from "../../../../packages/cloudflare/src/demo-test-check.ts";

const app = fileURLToPath(new URL("../../../../apps/effect-ci", import.meta.url));
const cf = process.env.CF_BIN ?? `${app}/node_modules/.bin/cf`;
const repo = "ericclemmons/effect-ci-testbed";
const hostVersion = "55ff142f-752c-41da-82a4-7f7e7c6fd17b";
// Issuer key pinned through the independently verified host, not receipt input.
const publicKey = {
  kty: "OKP",
  crv: "Ed25519",
  alg: "EdDSA",
  ext: true,
  key_ops: ["verify"],
  x: "S9Uuc0pt7ht8ZIPOYZtWzjEMoFzsWfBv44XFe3wqfng",
};
const json = (bin: string, args: string[]) =>
  JSON.parse(
    execFileSync(bin, args, {
      cwd: app,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
const instance = (id: string, workflow = "effect-ci-demo") =>
  json(cf, ["workflows", "instances", "get", id, "--workflow-name", workflow, "--simple", "false"]);

test(
  "retained trusted remote/SCM receipts and PR-only approval remain independently verifiable, without dispatch",
  {
    skip: process.env.VERIFY_TRUSTED_REMOTE !== "1",
    timeout: 180_000,
  },
  async () => {
    const key = await crypto.subtle.importKey("jwk", publicKey, "Ed25519", false, ["verify"]);
    const keys = new Map([["demo-trusted-runner-v1", key]]);
    const check = async (run: any, head: string) => {
      assert.equal(run.status, "complete");
      assert.equal(run.success, true);
      assert.equal(run.params.revision, head);
      const evidence = run.output.evidence;
      assert.deepEqual(evidence.publicKey, publicKey);
      const suite = evidence.receipts.find((r: any) => r.claim.identity.stepId === "test");
      assert.ok(suite);
      assert.equal(suite.claim.identity.revision, head);
      assert.equal(suite.claim.identity.repository, `https://github.com/${repo}`);
      assert.equal(suite.claim.identity.workflowId, "cf-ci-demo");
      assert.equal(suite.claim.identity.command, testCommand);
      assert.equal(suite.claim.identity.policyDigest, await demoRunnerPolicyDigest(true));
      assert.equal(
        await verifyRunnerCheckReceipt(JSON.stringify(suite), suite.claim.identity, keys),
        true,
      );
      const build = evidence.stepResults.find((r: any) => r.claim.identity.stepId === "build");
      assert.ok(build);
      assert.ok(
        await verifyRunnerStepReceipt(
          JSON.stringify(build),
          await demoBuildIdentity(head, hostVersion),
          keys,
        ),
      );
      return { suite, build };
    };
    const original = "ca90adf96ac5ffd8c5ef2e5254202f482ff9013b";
    const first = instance("45c5cd9a-b3c1-49c7-a94f-73f4c2b48360");
    const second = instance("cbcad0a8-16bf-468a-b0eb-52ce517fe308");
    assert.deepEqual(await check(second, original), await check(first, original));
    assert.equal(second.output.nodes.find((n: any) => n.id === "test").status, "verified");
    assert.equal(second.output.nodes.find((n: any) => n.id === "build").status, "reused");
    assert.ok(second.output.nodes.every((n: any) => !/publish|release|deploy/.test(n.id)));

    const readme = "9f8fd26bb80cbc4705b53fb95b67effacd39a487";
    const remote = instance("f0fd267b-03f4-49e4-a313-f430b7158cdc");
    const scm = instance("837af500-ca94-11f1-837e-3ff533395c7b");
    assert.deepEqual(await check(scm, readme), await check(remote, readme));
    assert.equal(scm.output.nodes.find((n: any) => n.id === "test").status, "verified");
    assert.equal(scm.output.nodes.find((n: any) => n.id === "build").status, "reused");
    assert.ok(!scm.steps.some((s: any) => /^command:\["(?:test|build)",1\]/.test(s.name)));

    for (const [number, id, eligible] of [
      [340, "review-ca003da0-ca94-11f1-8a1a-3362ded609ba-340", true],
      [341, "review-498e5ac0-ca95-11f1-9de2-d53a6741df50-341", false],
    ] as const) {
      const review = instance(id, "effect-ci-small-change-review");
      assert.equal(review.status, "complete");
      assert.equal(review.output.state, "complete");
      assert.equal(review.output.decision.eligible, eligible);
      assert.equal(review.output.decision.base, original);
      const reviews = json("gh", ["api", `repos/${repo}/pulls/${number}/reviews`]);
      if (eligible)
        assert.ok(
          reviews.some(
            (r: any) =>
              r.id === review.output.reviewId &&
              r.state === "APPROVED" &&
              r.user?.id === 334321206 &&
              r.user?.type === "Bot" &&
              r.commit_id === readme &&
              r.body.endsWith(`<!-- ${review.output.marker} -->`),
          ),
        );
      else {
        assert.equal(review.output.reviewId, undefined);
        assert.deepEqual(review.output.decision.reasons, [
          "Complete exact-head/base review with no P0/P1/P2 findings required.",
        ]);
        assert.ok(!reviews.some((r: any) => r.user?.id === 334321206 && r.state === "APPROVED"));
      }
    }
  },
);

test(
  "retained org workflow approves through three ordinary native actions after trusted remote verification",
  {
    skip: process.env.VERIFY_TRUSTED_REMOTE !== "1",
    timeout: 180_000,
  },
  async () => {
    const head = "a11e97f292058f2edca46cf6d56f06098610aa00";
    const remoteId = "c4a7cd1b-9a91-4c14-90c1-8c9783301846";
    const remote = instance(remoteId);
    assert.equal(remote.status, "complete");
    assert.equal(remote.success, true);
    assert.equal(remote.params.revision, head);
    const evidence = remote.output.evidence;
    assert.deepEqual(evidence.publicKey, publicKey);
    const keys = new Map([
      [
        "demo-trusted-runner-v1",
        await crypto.subtle.importKey("jwk", publicKey, "Ed25519", false, ["verify"]),
      ],
    ]);
    const suite = evidence.receipts.find((r: any) => r.claim.identity.stepId === "test");
    assert.ok(suite);
    assert.equal(suite.claim.runId, remoteId);
    assert.equal(suite.claim.identity.repository, `https://github.com/${repo}`);
    assert.equal(suite.claim.identity.revision, head);
    assert.equal(suite.claim.identity.workflowId, "cf-ci-demo");
    assert.equal(suite.claim.identity.command, testCommand);
    assert.equal(suite.claim.identity.policyDigest, await demoRunnerPolicyDigest(true));
    assert.equal(
      await verifyRunnerCheckReceipt(JSON.stringify(suite), suite.claim.identity, keys),
      true,
    );
    const build = evidence.stepResults.find((r: any) => r.claim.identity.stepId === "build");
    assert.ok(build);
    assert.equal(build.claim.runId, remoteId);
    assert.ok(
      await verifyRunnerStepReceipt(
        JSON.stringify(build),
        await demoBuildIdentity(head, "a71e9181-f4b8-4af2-9fe6-6fa50b5f31d4"),
        keys,
      ),
    );

    const review = instance(
      "review-d1c741e0-caa4-11f1-867e-0072b079b97d-345",
      "effect-ci-small-change-review",
    );
    assert.equal(review.status, "complete");
    assert.equal(review.success, true);
    assert.equal(review.params.number, 345);
    assert.equal(review.output.decision.eligible, true);
    assert.equal(review.output.decision.head, head);
    assert.equal(review.output.decision.base, "bddafc121abb97753fa85be6f0682f2390751cd4");
    assert.deepEqual(
      review.output.workflowPlan.nodes.map((n: any) => n.id),
      ["inspect PR", "review", "approve PR"],
    );
    assert.ok(review.output.workflowPlan.nodes.every((n: any) => n.status === "complete"));
    assert.deepEqual(
      review.steps.map((s: any) => s.name),
      ['action:"inspect PR"-1', 'action:"review"-1', 'action:"approve PR"-1'],
    );
    assert.ok(
      review.steps.every(
        (s: any) => s.success && s.attempts.length === 1 && s.config.retries.limit === 0,
      ),
    );
    const inspected = JSON.parse(review.steps[0].output).value.data;
    assert.equal(inspected.review.kind, "documentation-policy");
    assert.ok(inspected.experience.docs.length >= 10);

    const pr = json("gh", ["api", `repos/${repo}/pulls/345`]);
    assert.equal(pr.head.sha, head);
    assert.equal(pr.state, "closed");
    assert.equal(pr.merged, false);
    assert.equal(pr.auto_merge, null);
    const approvals = json("gh", ["api", `repos/${repo}/pulls/345/reviews`]).filter(
      (r: any) =>
        r.user?.id === 334321206 &&
        r.user?.type === "Bot" &&
        r.state === "APPROVED" &&
        r.commit_id === head,
    );
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].id, review.output.reviewId);
    assert.ok(approvals[0].body.endsWith(`<!-- ${review.output.marker} -->`));
    const checks = json("gh", [
      "api",
      `repos/${repo}/commits/${head}/check-runs?check_name=small-change&app_id=5089816&per_page=100&filter=all`,
    ]);
    assert.ok(
      checks.check_runs.some(
        (c: any) =>
          c.id === review.output.checkId &&
          c.head_sha === head &&
          c.app?.id === 5089816 &&
          c.conclusion === "success" &&
          c.external_id === review.output.marker,
      ),
    );
  },
);
