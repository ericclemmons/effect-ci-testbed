import assert from "node:assert/strict";
import test from "node:test";
import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import { retainShowcaseAttempt, restoreShowcaseAttempt } from "./showcase-attempt.ts";

test("an explicit compute rerun preserves the previous attempt and restores prerequisites under its new owner", async () => {
  const firstOwner = "11111111-1111-4111-8111-111111111111";
  const nextOwner = "22222222-2222-4222-8222-222222222222";
  const version = "33333333-3333-4333-8333-333333333333", revision = "a".repeat(40);
  const counts = { checkout: 0, install: 0, lint: 0, test: 0, build: 0 };
  let owner = firstOwner;
  const checkout = CI.action("checkout", () => function* () {
    counts.checkout++; return CI.Workspace.remote(owner, "/workspace/repository/examples/demo");
  });
  const install = CI.action("install", function* () {
    const workspace = yield* checkout();
    return function* () { counts.install++; return workspace; };
  });
  const lint = CI.check("lint", () => function* () { yield* install(); counts.lint++; });
  const check = CI.check("test", () => function* () {
    const workspace = yield* install(); assert.equal(workspace.id, owner); counts.test++;
  });
  const build = CI.action("build", function* () {
    yield* CI.parallel([lint(), check()]); const workspace = yield* install();
    return function* () { counts.build++; assert.equal(workspace.id, owner); return workspace; };
  });
  const workflow = CI.workflow("demo", () => build());
  let attempt!: CI.WorkflowAttempt;
  const configuration: CI.RunOptions = { output: "silent", onAttempt: value => { attempt = value; },
    workspacePersistence: {
      commit: request => Effect.succeed(request.workspace.withRevision({ provider: "cloudflare-container",
        value: { id: `PRIVATE-${request.stepId}`, size: 1 } })),
      checkpoint: () => Effect.die("unused"), restore: () => Effect.die("unused"),
    },
  };
  await CI.runPromise(workflow, configuration);
  const retained = retainShowcaseAttempt(attempt, { revision, version, instanceId: firstOwner });
  assert.ok(retained);
  const computeOnly = { ...attempt, requested: ["lint", "test"],
    plan: { ...attempt.plan, nodes: attempt.plan.nodes.filter(node => node.id !== "build") },
    outputs: Object.fromEntries(Object.entries(attempt.outputs).filter(([id]) => id !== "build")) };
  assert.ok(retainShowcaseAttempt(computeOnly, { revision, version, instanceId: firstOwner }),
    "a successful lint/test baseline need not contain an unrequested build output");
  const { install: omitted, ...missingOutput } = computeOnly.outputs;
  assert.equal(retainShowcaseAttempt({ ...computeOnly, outputs: missingOutput }, { revision, version, instanceId: firstOwner }), undefined,
    "every action that did enter the plan still needs its retained output");
  const original = JSON.stringify(retained);
  owner = nextOwner;
  const restored = restoreShowcaseAttempt(JSON.parse(original), { revision, version, instanceId: nextOwner });
  const run = await CI.runPromise(workflow, { ...configuration, rerun: { previous: restored, steps: ["test"] } });
  assert.deepEqual(counts, { checkout: 1, install: 1, lint: 1, test: 2, build: 2 });
  assert.equal(run.plan.nodes.find(node => node.id === "lint")?.status, "reused");
  assert.equal(attempt.number, 2);
  assert.equal(attempt.previousAttemptId, `${firstOwner}:1`);
  assert.equal(JSON.stringify(retained), original);
  assert.throws(() => restoreShowcaseAttempt(retained, { revision: "b".repeat(40), version, instanceId: nextOwner }));
  assert.throws(() => restoreShowcaseAttempt(retained, { revision, version: nextOwner, instanceId: nextOwner }));
  assert.equal(retainShowcaseAttempt({ ...attempt, conclusion: "failure" }, { revision, version, instanceId: nextOwner }), undefined,
    "the first enrolled rerun path never resumes uncertain failed executions");
  assert.equal(retainShowcaseAttempt({ ...attempt, plan: { ...attempt.plan,
    nodes: [...attempt.plan.nodes, { ...attempt.plan.nodes[0]!, id: "publish preview" }] } },
    { revision, version, instanceId: nextOwner }), undefined, "publication and human decisions are not compute rerun inputs");
});
