import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { BUDGET_NAME } from "./budget.ts";

test(
  "retained native stream replays exact bytes without another durable charge",
  {
    skip: !process.env.LIVE_REPAIR_RECOVERY_INSTANCE,
  },
  () => {
    const id = process.env.LIVE_REPAIR_RECOVERY_INSTANCE!;
    assert.match(id, /^[a-zA-Z0-9_-]{1,80}$/);
    const get = (args: string[]) =>
      JSON.parse(
        execFileSync(process.env.CF_BIN ?? "cf", args, {
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        }),
      );
    const run = get([
      "workflows",
      "instances",
      "get",
      id,
      "--workflow-name",
      "effect-ci-repair-budget-probe",
    ]);
    assert.equal(run.status, "complete");
    assert.equal(run.params.mode, "recovery");
    assert.deepEqual(
      run.steps.map((step: any) => step.name),
      [
        "budget:before-1",
        "budget:owned-stream-1",
        "budget:charged-1",
        "budget:replay-stream-1",
        "budget:after-1",
      ],
    );
    assert.ok(
      run.steps.every(
        (step: any) =>
          step.success && step.attempts.length === 1 && step.config.retries.limit === 0,
      ),
    );
    const evidence = run.output;
    assert.equal(evidence.before.budget, BUDGET_NAME);
    assert.equal(evidence.charged.budget, BUDGET_NAME);
    assert.equal(evidence.after.budget, BUDGET_NAME);
    assert.equal(evidence.charged.reservedCents, evidence.before.reservedCents + 10);
    assert.deepEqual(evidence.after, evidence.charged);
    assert.equal(evidence.after.remainingCents + evidence.after.reservedCents, 200);
    assert.equal(evidence.reservationId, `probe_${id}`);
    assert.equal(
      evidence.after.reservations.filter((r: any) => r.id === evidence.reservationId).length,
      1,
    );
    assert.equal(evidence.replayMatches, true);
    assert.equal(evidence.replayInferenceCalled, false);
    assert.equal(evidence.flueVerified, false);
    assert.equal(evidence.repairVerified, false);
    const outputs = ["budget:owned-stream-1", "budget:replay-stream-1"].map((name) => {
      const step = get([
        "workflows",
        "instances",
        "step",
        "get",
        id,
        "--workflow-name",
        "effect-ci-repair-budget-probe",
        "--name",
        name,
        "--type",
        "step",
      ]).result;
      assert.equal(step.status, "complete");
      assert.equal(step.error, null);
      assert.equal(step.output.contentType, "text/event-stream");
      assert.equal(step.output.reservationId, evidence.reservationId);
      assert.equal(Buffer.byteLength(step.output.body), evidence.byteLength);
      assert.ok(evidence.byteLength > 0 && evidence.byteLength <= 65_536);
      assert.equal(
        createHash("sha256").update(step.output.body).digest("hex"),
        evidence.bodySha256,
      );
      return step.output;
    });
    assert.deepEqual(outputs[0], outputs[1]);
    assert.ok(
      !/gh[spr]_[A-Za-z0-9]+|x-access-token:|Bearer /.test(
        JSON.stringify(run) + JSON.stringify(outputs),
      ),
    );
  },
);
