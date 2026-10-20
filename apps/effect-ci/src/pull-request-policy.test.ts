import assert from "node:assert/strict";
import test from "node:test";
import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import authored, { approve } from "./workflows/pull-request.ts";
import { pullRequestPolicy } from "./pull-request-policy.ts";
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
  assert.deepEqual(result.plan.nodes, []);
  const approvalPlan = await CI.runPromise(CI.workflow("approval-plan", () => actions.approve()), { mode: "plan", output: "silent" });
  assert.equal(approvalPlan.plan.nodes[0]?.options.retries?.limit, 0);
  assert.equal(CI.isAction(approve), true);
  assert.deepEqual((await CI.runPromise(authored, { mode: "plan", output: "silent" })).plan.nodes, []);
  await assert.rejects(CI.runPromise(CI.workflow("unbound-approval", () => approve()), { output: "silent" }), /requires its trusted host capabilities/);
});

test("source guard approves non-code changes and leaves TS, TSX and JSON on normal review", async () => {
  for (const [paths, eligible] of [
    [["README.md"], true], [["docs/README.md", "CHANGELOG.md"], true],
    [["index.ts"], false], [["src/Button.tsx"], false], [["package.json"], false],
    [["README.md", "src/index.ts"], false],
  ] as const) {
    const input = { ...evidence(), files: paths.map(path => ({ path, additions: 1, deletions: 1 })) };
    let reads = 0, writes = 0;
    const actions = pullRequestPolicy({ read: async () => { reads++; return input; },
      publish: async (observed, decision) => { writes++; assert.equal(observed, input);
        assert.equal(decision.eligible, eligible);
        return { state: "complete", marker: "fixture", decision, checkId: 1, ...(eligible ? { reviewId: 2 } : {}) }; } });
    const result = await CI.runPromise(actions.workflow, { output: "silent", source: actions.source });
    assert.equal(result.value?.decision.eligible, eligible ? true : undefined);
    assert.equal(result.value?.reviewId, eligible ? 2 : undefined);
    assert.equal(reads, 1); assert.equal(writes, eligible ? 1 : 0);
    assert.ok(result.plan.nodes.every(node => node.status === "complete"));
  }
});

test("an uncertain approval acknowledgement is not retried by the workflow", async () => {
  let writes = 0;
  const actions = pullRequestPolicy({ read: async () => evidence(),
    publish: async () => { writes++; throw Error("uncertain provider acknowledgement"); } });
  await assert.rejects(CI.runPromise(actions.workflow, { output: "silent", source: actions.source }), /uncertain provider acknowledgement/);
  assert.equal(writes, 1);
});

test("unknown or invalid canonical diffs cannot pass the negated source guard", async () => {
  const initial = evidence();
  for (const change of [
    { complete: false }, { files: [] }, { draft: true }, { open: false },
    { head: "unknown" }, { files: [...initial.files, ...initial.files] },
    { files: [{ path: "../README.md", additions: 1, deletions: 0 }] },
  ]) {
    const policy = pullRequestPolicy({ read: async () => ({ ...initial, ...change }),
      publish: async () => assert.fail("Invalid diff must leave approval unchanged") });
    const result = await CI.runPromise(policy.workflow, { source: policy.source, output: "silent" });
    assert.equal(result.value, undefined);
    assert.deepEqual(result.plan.nodes, []);
  }
  const offline = pullRequestPolicy({ read: async () => { throw Error("Diff unavailable"); },
    publish: async () => assert.fail("Unknown diff must not publish approval") });
  assert.equal((await CI.runPromise(offline.workflow, { source: offline.source, output: "silent" })).value, undefined);
});

test("a caller cannot substitute a non-code Source to approve canonical code changes", async () => {
  const policy = pullRequestPolicy({ read: async () => ({ ...evidence(), files: [{ path: "src/index.tsx", additions: 1, deletions: 1 }] }),
    publish: async () => assert.fail("Substituted source must not authorize a write") });
  const result = await CI.runPromise(policy.workflow, { output: "silent", source: {
    checkout: policy.source.checkout,
    changes: () => Effect.succeed({ status: "known", base: "b".repeat(40), head: "a".repeat(40), paths: ["README.md"] }),
  } });
  assert.equal(result.value, undefined);
});
