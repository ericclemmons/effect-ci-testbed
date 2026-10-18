import assert from "node:assert/strict";
import test from "node:test";
import * as CI from "./index.ts";
import * as Effect from "effect/Effect";

test("thrown and typed failures mark their origin failed and blocked dependents skipped", async () => {
  for (const typed of [false, true]) {
    const original = Error(typed ? "typed failure" : "thrown failure");
    let attempt: CI.WorkflowAttempt | undefined, builds = 0;
    const events: CI.RuntimeEvent[] = [];
    const prepare = CI.action<string>("prepare", () => function* () { return "prepared"; });
    const check = CI.check("test", function* () {
      yield* prepare();
      return function* () {
        if (typed) return yield* Effect.fail(original);
        throw original;
      };
    });
    const build = CI.action<string>("build", function* () {
      yield* check();
      return function* () { builds++; return "built"; };
    });
    await assert.rejects(CI.runPromise(CI.workflow("failure-status", () => build()), {
      output: "silent", onAttempt: value => { attempt = value; }, onEvent: event => { events.push(event); },
    }), typed ? /typed failure/ : /thrown failure/);
    assert.ok(attempt);
    assert.equal(attempt.conclusion, "failure");
    assert.equal(attempt.plan.nodes.find(n => n.id === "test")!.status, "failed");
    assert.equal(attempt.plan.nodes.find(n => n.id === "build")!.status, "skipped");
    assert.equal(attempt.outputs.prepare, "prepared");
    assert.equal(Object.hasOwn(attempt.outputs, "test"), false);
    assert.equal(Object.hasOwn(attempt.outputs, "build"), false);
    assert.equal(builds, 0);
    assert.deepEqual(events.flatMap(e => e.type === "step.status" && e.status === "failed" ? [e.stepId] : []), ["test"]);
  }
});

test("interrupted parallel siblings are skipped, not falsely left queued or marked as failures", async () => {
  let attempt: CI.WorkflowAttempt | undefined, completed = false;
  const broken = CI.action<void>("broken", () => function* () { yield* Effect.sleep(10); throw Error("original failure"); });
  const sibling = CI.action<void>("sibling", () => function* () { yield* Effect.sleep(1000); completed = true; });
  await assert.rejects(CI.runPromise(CI.workflow("parallel-failure", function* () {
    yield* CI.parallel([broken(), sibling()]);
  }), { output: "silent", onAttempt: value => { attempt = value; } }), /original failure/);
  assert.ok(attempt);
  assert.equal(attempt.plan.nodes.find(n => n.id === "broken")!.status, "failed");
  assert.equal(attempt.plan.nodes.find(n => n.id === "sibling")!.status, "skipped");
  assert.equal(completed, false);
});
