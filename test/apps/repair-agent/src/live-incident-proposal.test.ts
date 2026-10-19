import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  INCIDENT_PROPOSAL_INSTANCE,
  INCIDENT_IDENTITY,
  INCIDENT_ADMITTED_AT,
} from "@effect-ci-testbed/github/incident-proposal";

test(
  "retained native admitted-Issue Flue proposal made one fresh reservation after admission without GitHub writes",
  { skip: !process.env.LIVE_INCIDENT_FLUE },
  () => {
    assert.equal(process.env.LIVE_INCIDENT_FLUE, INCIDENT_PROPOSAL_INSTANCE);
    const get = (id: string, workflow: string) =>
      JSON.parse(
        execFileSync(
          process.env.CF_BIN ?? "/Users/eric/Library/pnpm/bin/cf",
          ["workflows", "instances", "get", id, "--workflow-name", workflow],
          { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
        ),
      );
    const run = get(
      INCIDENT_PROPOSAL_INSTANCE,
      "effect-ci-owned-incident-proposal",
    );
    assert.equal(run.status, "complete");
    assert.equal(run.success, true);
    assert.equal(run.versionId, "c584b280-2ae8-486b-8ea7-7b50ec9b9ca5");
    assert.deepEqual(run.params, { mode: "proposal" });
    assert.equal(run.step_count, 5);
    assert.deepEqual(
      run.steps.map((step: { name: string }) => step.name),
      [
        "incident:verify-admission-1",
        "proposal:budget-before-1",
        "proposal:admit-1",
        "proposal:read-1",
        "proposal:budget-after-1",
      ],
    );
    for (const step of run.steps) {
      assert.equal(step.success, true);
      assert.equal(step.attempts.length, 1);
      assert.equal(step.attempts[0].success, true);
      assert.equal(step.config.retries.limit, 0);
    }
    const out = run.output;
    assert.deepEqual(out.admitted.identity, INCIDENT_IDENTITY);
    assert.equal(out.admitted.admittedAt, INCIDENT_ADMITTED_AT);
    assert.ok(Date.parse(run.start) > INCIDENT_ADMITTED_AT);
    assert.equal(
      out.admitted.activationPolicy,
      "host-owned-incident-proposal-only-v1",
    );
    assert.equal(
      out.eventActivation,
      "authenticated-operator-continuation-of-admitted-issue",
    );
    assert.equal(out.githubWritePerformed, false);
    assert.equal(out.repairVerified, false);
    const p = out.proposal;
    const id =
      "flue_54c540e5b12e62cae83001008487f8a26b1652a7664fb511a576e045f8e47c87";
    assert.equal(p.text, "export function healthStatus() { return 200; }");
    assert.equal(p.reservationId, id);
    assert.equal(p.proposalOnly, true);
    assert.equal(p.repairVerified, false);
    assert.equal(p.before.reservedCents, 40);
    assert.equal(p.before.remainingCents, 660);
    assert.equal(p.after.reservedCents, 50);
    assert.equal(p.after.remainingCents, 650);
    assert.equal(p.before.budget, "friday-demo-repair-2-usd-v1");
    assert.equal(p.after.budget, p.before.budget);
    assert.equal(p.before.reservations.length, 4);
    assert.deepEqual(p.after.reservations.slice(0, 4), p.before.reservations);
    assert.deepEqual(p.after.reservations[4], {
      id,
      run: "friday-flue-proposal-v1",
    });
    assert.deepEqual(JSON.parse(run.steps[3].output), {
      text: p.text,
      reservationId: id,
    });
    const before = get(
      "coverage-incident-flue-budget-before-20261014-1",
      "effect-ci-flue-proposal-probe",
    );
    const after = get(
      "coverage-incident-flue-budget-after-20261014-1",
      "effect-ci-flue-proposal-probe",
    );
    for (const inspect of [before, after]) {
      assert.equal(inspect.status, "complete");
      assert.equal(inspect.output.inferenceCalled, false);
      assert.equal(inspect.step_count, 1);
      assert.equal(inspect.steps[0].attempts.length, 1);
      assert.equal(inspect.steps[0].config.retries.limit, 0);
    }
    assert.deepEqual(before.output.before, p.before);
    assert.deepEqual(after.output.before, p.after);
    // A retained proposal is UNTRUSTED text, not verification, automatic activation,
    // forced process restart or authority to execute model code/merge/deploy.
  },
);
