import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { INCIDENT_PROPOSAL_INSTANCE } from "@effect-ci-testbed/github/incident-proposal";

test("retained native incident evidence reader, no dispatch", {
  skip: !process.env.LIVE_INCIDENT_EVIDENCE,
}, () => {
  assert.equal(process.env.LIVE_INCIDENT_EVIDENCE,
    "cf_3fd031ac19e7130f22c40e61a51b95af933aeee6d70eee40a40cdb5a4a569653");
  const read = (instance: string, workflow: string) => JSON.parse(execFileSync(
    process.env.CF_BIN ?? "cf",
    ["workflows", "instances", "get", instance, "--workflow-name", workflow],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 },
  ));
  const history = read(process.env.LIVE_INCIDENT_EVIDENCE!, "effect-ci-owned-incident-evidence");
  assert.equal(history.status, "complete");
  assert.equal(history.success, true);
  assert.deepEqual(history.params, { mode: "read" });
  assert.equal(history.steps.length, 1);
  assert.equal(history.steps[0].name, "incident:read-proposal-evidence-1");
  assert.equal(history.steps[0].attempts.length, 1);
  assert.equal(history.steps[0].config.retries.limit, 0);
  assert.deepEqual(JSON.parse(history.steps[0].output), history.output);
  assert.deepEqual(history.output, {
    instance: INCIDENT_PROPOSAL_INSTANCE,
    reservationId: "flue_54c540e5b12e62cae83001008487f8a26b1652a7664fb511a576e045f8e47c87",
    run: "friday-flue-proposal-v1",
    text: "export function healthStatus() { return 200; }",
    issueId: "e28e6b86-bea4-440f-8729-be6437e97293",
    operationId: "owned-issue:e28e6b86-bea4-440f-8729-be6437e97293",
    activationPolicy: "host-owned-incident-proposal-only-v1",
  });
  const budget = read("coverage-incident-evidence-budget-after-20261014-1", "effect-ci-flue-proposal-probe");
  assert.equal(budget.status, "complete");
  assert.equal(budget.output.inferenceCalled, false);
  assert.equal(budget.output.before.reservedCents, 50);
  assert.equal(budget.output.before.remainingCents, 650);
  assert.equal(budget.output.before.reservations.length, 5);
  assert.ok(budget.output.before.reservations.some((r: { id: string }) => r.id === history.output.reservationId));
});
