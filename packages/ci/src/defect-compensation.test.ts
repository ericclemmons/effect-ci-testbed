import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as CI from "./index.ts";

test("typed and thrown action failures compensate the failed action then completed actions", async () => {
  for (const thrown of [false, true]) {
    const calls: string[] = [];
    const original = Error("business failure");
    let attempt: CI.WorkflowAttempt | undefined;
    const rollbackFirst = CI.action<void>("undo first", () => function* () { calls.push("undo first"); });
    const first = CI.action<void>("first", () => function* () { calls.push("first"); }, { rollback: rollbackFirst });
    const rollbackSecond = CI.action<void>("undo second", () => function* () { calls.push("undo second"); });
    const second = CI.action<void>("second", () => function* () {
      calls.push("second");
      if (thrown) throw original;
      return yield* Effect.fail(original);
    }, { rollback: rollbackSecond });
    const result = await Effect.runPromise(Effect.exit(CI.run(CI.workflow("compensation", function* () {
      yield* first();
      yield* second();
    }), { output: "silent", onAttempt: value => { attempt = value; } })));
    assert.ok(Exit.isFailure(result));
    assert.equal(Cause.squash(result.cause), original);
    assert.deepEqual(calls, ["first", "second", "undo second", "undo first"]);
    assert.equal(attempt?.conclusion, "failure");
    for (const id of ["undo first", "undo second"]) {
      assert.equal(attempt?.plan.nodes.find(node => node.id === id)?.status, "complete");
    }
  }
});

test("a thrown compensation failure retains both errors and does not abandon older compensations", async () => {
  const original = Error("business failure"), rollbackError = Error("compensation failure");
  const calls: string[] = [];
  const undoFirst = CI.action<void>("undo first", () => function* () { calls.push("undo first"); });
  const first = CI.action<void>("first", () => function* () {}, { rollback: undoFirst });
  const undoSecond = CI.action<void>("undo second", () => function* () {
    calls.push("undo second");
    throw rollbackError;
  });
  const second = CI.action<void>("second", () => function* () { return yield* Effect.fail(original); }, { rollback: undoSecond });
  const result = await Effect.runPromise(Effect.exit(CI.run(CI.workflow("failed-compensation", function* () {
    yield* first();
    yield* second();
  }), { output: "silent" })));
  assert.ok(Exit.isFailure(result));
  const error = Cause.squash(result.cause);
  assert.ok(error instanceof CI.RollbackError);
  assert.equal(error.original, original);
  assert.equal(error.rollback, rollbackError);
  assert.deepEqual(calls, ["undo second", "undo first"]);
});

test("success and interruption-only exits do not initiate failure compensation", async () => {
  for (const interrupt of [false, true]) {
    let rollbacks = 0;
    const rollback = CI.action<void>("undo", () => function* () { rollbacks++; });
    const first = CI.action<void>("first", () => function* () {}, { rollback });
    const result = await Effect.runPromise(Effect.exit(CI.run(CI.workflow("no-failure", function* () {
      yield* first();
      if (interrupt) yield* Effect.interrupt;
    }), { output: "silent" })));
    assert.equal(Exit.isFailure(result), interrupt);
    assert.equal(rollbacks, 0);
  }
});
