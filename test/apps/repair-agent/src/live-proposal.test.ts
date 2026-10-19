import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
test(
  "retained native Flue proposal completed once through the real private budget service",
  { skip: !process.env.LIVE_FLUE_INSTANCE },
  () => {
    const instance = process.env.LIVE_FLUE_INSTANCE!;
    assert.equal(instance, "coverage-flue-proposal-20261014-1");
    const cli = process.env.CF_BIN ?? "/Users/eric/Library/pnpm/bin/cf";
    const get = (id: string) =>
      JSON.parse(
        execFileSync(
          cli,
          ["workflows", "instances", "get", id, "--workflow-name", "effect-ci-flue-proposal-probe"],
          { encoding: "utf8", timeout: 30000 },
        ),
      );
    const run = get(instance);
    assert.equal(run.status, "complete");
    assert.equal(run.success, true);
    assert.equal(run.step_count, 4);
    assert.equal(run.versionId, "838475c8-eed2-4ce3-8014-ebebfa754deb");
    assert.deepEqual(
      run.steps.map((s: { name: string }) => s.name),
      [
        "proposal:budget-before-1",
        "proposal:admit-1",
        "proposal:read-1",
        "proposal:budget-after-1",
      ],
    );
    for (const step of run.steps) {
      assert.equal(step.success, true);
      assert.equal(step.config.retries.limit, 0);
      assert.equal(step.attempts.length, 1);
      assert.equal(step.attempts[0].success, true);
    }
    const value = run.output;
    assert.equal(value.text, "export function healthStatus() { return 200; }");
    assert.equal(value.proposalOnly, true);
    assert.equal(value.repairVerified, false);
    assert.equal(value.before.reservedCents, 30);
    assert.equal(value.before.remainingCents, 670);
    assert.equal(value.after.reservedCents, 40);
    assert.equal(value.after.remainingCents, 660);
    assert.deepEqual(value.after.reservations.slice(0, 3), value.before.reservations);
    assert.deepEqual(value.after.reservations[3], {
      id: value.reservationId,
      run: "friday-flue-proposal-v1",
    });
    assert.match(value.reservationId, /^flue_[a-f0-9]{64}$/);
    const saved = JSON.parse(run.steps[2].output);
    assert.equal(saved.text, value.text);
    assert.equal(saved.reservationId, value.reservationId);
    const independent = get("coverage-flue-inspect-after-20261014-1");
    assert.equal(independent.status, "complete");
    assert.equal(independent.output.inferenceCalled, false);
    assert.deepEqual(independent.output.before, value.after);
  },
);
