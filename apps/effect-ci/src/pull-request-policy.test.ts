import assert from "node:assert/strict";
import test from "node:test";
import * as CI from "@effect-ci-testbed/ci";
import authored, { approve, pullRequestPolicy } from "./workflows/pull-request.ts";
import type { SmallChangeEvidence } from "../../../packages/github/src/small-change.ts";

const evidence = (): SmallChangeEvidence => ({
  head: "a".repeat(40), base: "b".repeat(40), open: true, draft: false, complete: true,
  files: [{ path: "README.md", additions: 5000, deletions: 5000 }],
  checks: [],
  review: { head: "a".repeat(40), base: "b".repeat(40), complete: false, kind: "ai", findings: [] },
  experience: {},
});

test("org approval is an ordinary inspectable action; planning invokes no capabilities", async () => {
  const actions = pullRequestPolicy({ read: async () => assert.fail("plan read GitHub"),
    publish: async () => assert.fail("plan wrote GitHub") });
  const result = await CI.runPromise(actions.workflow, { mode: "plan", output: "silent" });
  assert.deepEqual(result.plan.nodes.map(node => node.id), ["inspect PR", "review", "approve PR"]);
  assert.deepEqual(result.plan.nodes.find(node => node.id === "approve PR")?.dependencies, ["inspect PR", "review"]);
  assert.equal(result.plan.nodes.find(node => node.id === "approve PR")?.options.retries?.limit, 0);
  assert.equal(CI.isAction(approve), true);
  assert.deepEqual((await CI.runPromise(authored, { mode: "plan", output: "silent" })).plan.nodes.map(node => node.id),
    result.plan.nodes.map(node => node.id));
  await assert.rejects(CI.runPromise(authored, { output: "silent" }), /requires its trusted host capabilities/);
});

test("workflow decides eligibility from trusted results; the host receives the exact verdict", async () => {
  for (const eligible of [true, false]) {
    let input = evidence();
    if (!eligible) input = { ...input, files: [{ path: "test/fixtures/demo/src/message.ts", additions: 1, deletions: 1 }],
      review: { ...input.review, kind: "ai", complete: false }, experience: { demo: Array.from({ length: 10 }, (_, i) => i + 1) } };
    let reads = 0, writes = 0;
    const actions = pullRequestPolicy({ read: async () => { reads++; return input; },
      publish: async (observed, decision) => { writes++; assert.equal(observed, input);
        assert.equal(decision.eligible, eligible);
        return { state: "complete", marker: "fixture", decision, checkId: 1, ...(eligible ? { reviewId: 2 } : {}) }; } });
    const result = await CI.runPromise(actions.workflow, { output: "silent" });
    assert.ok(result.value);
    assert.equal(result.value.decision.eligible, eligible);
    assert.equal(result.value.reviewId, eligible ? 2 : undefined);
    assert.equal(reads, 1); assert.equal(writes, 1);
    assert.ok(result.plan.nodes.every(node => node.status === "complete"));
  }
});

test("an uncertain approval acknowledgement is not retried by the workflow", async () => {
  let writes = 0;
  const actions = pullRequestPolicy({ read: async () => evidence(),
    publish: async () => { writes++; throw Error("uncertain provider acknowledgement"); } });
  await assert.rejects(CI.runPromise(actions.workflow, { output: "silent" }), /uncertain provider acknowledgement/);
  assert.equal(writes, 1);
});
