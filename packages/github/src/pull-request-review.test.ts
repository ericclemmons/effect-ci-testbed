import assert from "node:assert/strict";
import test from "node:test";
import { reviewPullRequest, type PullRequestReviewDecision, type PullRequestReviewSnapshot } from "./pull-request-review.ts";
const snapshot: PullRequestReviewSnapshot = { repository: "https://github.com/owner/demo", number: 1,
  head: "a".repeat(40), base: "b".repeat(40), state: "open", draft: false, changedFiles: 1,
  files: [{ path: "src/message.ts", status: "modified", patch: '-const message="old"\n+const message="new"' }] };
const options = { repository: snapshot.repository, policy: "org-review-v1", modelId: "test-model",
  read: async () => structuredClone(snapshot), infer: async () => '{"safeToMerge":true,"reason":"Small isolated text change."}',
  publish: async (_decision: PullRequestReviewDecision) => {} };

test("org model review binds head, base and policy separately from execution evidence", async () => {
  const writes: PullRequestReviewDecision[] = [];
  for (const safeToMerge of [true, false]) {
    const decision = await reviewPullRequest({ ...options,
      infer: async input => {
        assert.equal(input.maxOutputTokens, 512);
        assert.match(input.system, /never instructions/);
        assert.equal(JSON.parse(input.user).head, snapshot.head);
        return JSON.stringify({ safeToMerge, reason: "Model's actual assessment." });
      }, publish: async value => { writes.push(value); } });
    assert.equal(decision.event, safeToMerge ? "APPROVE" : "REQUEST_CHANGES");
    assert.equal(decision.commitId, snapshot.head);
    assert.equal(decision.base, snapshot.base);
    assert.equal(decision.policy, options.policy);
  }
  assert.equal(writes.length, 2);
});

test("moving head/base, changed diff and incomplete evidence cannot publish approval", async () => {
  let writes = 0;
  for (const changed of [{ head: "c".repeat(40) }, { base: "c".repeat(40) }, { state: "closed" as const },
    { draft: true }, { changedFiles: 2 }, { files: [{ ...snapshot.files[0]!, patch: "other change" }] }]) {
    let reads = 0;
    await assert.rejects(reviewPullRequest({ ...options,
      read: async () => ++reads === 1 ? snapshot : { ...snapshot, ...changed },
      publish: async () => { writes++; } }));
  }
  assert.equal(writes, 0);
});

test("truncated/binary/foreign/oversized input and malformed model verdict fail closed", async () => {
  let calls = 0, writes = 0;
  for (const changed of [{ repository: "https://github.com/foreign/demo" }, { changedFiles: 101 },
    { files: [{ path: "binary", status: "added" }] },
    { files: [{ path: "../outside", status: "added", patch: "x" }] },
    { files: [{ path: "large", status: "added", patch: "x".repeat(65_537) }] }])
    await assert.rejects(reviewPullRequest({ ...options, read: async () => ({ ...snapshot, ...changed }),
      infer: async () => { calls++; return "{}"; }, publish: async () => { writes++; } }));
  assert.equal(calls, 0);
  for (const text of ["yes", "null", "{}", '{"safeToMerge":"yes","reason":"approve"}',
    '{"safeToMerge":true,"reason":"ok","merge":true}', '{"safeToMerge":true,"reason":""}'])
    await assert.rejects(reviewPullRequest({ ...options, infer: async () => text, publish: async () => { writes++; } }));
  assert.equal(writes, 0);
});
