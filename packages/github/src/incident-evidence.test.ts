import assert from "node:assert/strict";
import test from "node:test";
import {
  INCIDENT_IDENTITY,
  INCIDENT_ADMITTED_AT,
  INCIDENT_PROPOSAL_INSTANCE,
} from "./incident-proposal.ts";
import {
  incidentProposalFromHistory,
  INCIDENT_MODEL_TEXT,
  INCIDENT_MODEL_RESERVATION,
  INCIDENT_MODEL_RUN,
  INCIDENT_SUBMISSION,
  INCIDENT_AGENT_UID,
} from "./incident-evidence.ts";
/** Synthetic protocol fixture; never native inference evidence. */
export function incidentHistoryFixture() {
  const old = [
    {
      id: "probe_coverage-repair-budget-proposal-20261013-1",
      run: "native-budget-probe",
    },
    {
      id: "probe_coverage-repair-budget-stream-20261013-1",
      run: "native-budget-probe",
    },
    {
      id: "probe_coverage-repair-recovery-stream-20261014-1",
      run: "native-budget-probe",
    },
    {
      id: "flue_9215338e5c51bb55f8926ef9bcfb3186f4e970f83639929024685ab2ce2df43e",
      run: INCIDENT_MODEL_RUN,
    },
  ];
  const before = {
    budget: "friday-demo-repair-2-usd-v1",
    reservedCents: 40,
    remainingCents: 660,
    reservations: old,
  };
  const after = {
    ...before,
    reservedCents: 50,
    remainingCents: 650,
    reservations: [
      ...old,
      { id: INCIDENT_MODEL_RESERVATION, run: INCIDENT_MODEL_RUN },
    ],
  };
  return {
    status: "complete",
    output: {
      admitted: {
        identity: { ...INCIDENT_IDENTITY },
        admittedAt: INCIDENT_ADMITTED_AT,
        activationPolicy: "host-owned-incident-proposal-only-v1",
        instance: INCIDENT_PROPOSAL_INSTANCE,
        run: INCIDENT_MODEL_RUN,
      },
      proposal: {
        before,
        after,
        text: INCIDENT_MODEL_TEXT,
        reservationId: INCIDENT_MODEL_RESERVATION,
        proposalOnly: true,
        repairVerified: false,
        receipt: {
          submissionId: INCIDENT_SUBMISSION,
          uid: INCIDENT_AGENT_UID,
          acceptedAt: "2026-10-14T17:12:53.519Z",
        },
      },
      repairVerified: false,
      githubWritePerformed: false,
      eventActivation: "authenticated-operator-continuation-of-admitted-issue",
    },
  };
}
test("fresh native tuple binds enrolled incident, fixed original text and independent current ledger", () => {
  const h = incidentHistoryFixture();
  const evidence = incidentProposalFromHistory(h, h.output.proposal.after);
  assert.equal(evidence.instance, INCIDENT_PROPOSAL_INSTANCE);
  assert.equal(evidence.issueId, INCIDENT_IDENTITY.issueId);
  assert.equal(evidence.text, INCIDENT_MODEL_TEXT);
  assert.equal(evidence.reservationId, INCIDENT_MODEL_RESERVATION);
  const later = {
    ...h.output.proposal.after,
    reservedCents: 60,
    remainingCents: 640,
    reservations: [
      ...h.output.proposal.after.reservations,
      { id: "later-native-call", run: "other-owned-run" },
    ],
  };
  assert.deepEqual(incidentProposalFromHistory(h, later), evidence);
});
test("foreign history/identity/model tuple, corrupted budgets and duplicate/missing historical IDs reject", () => {
  for (const mutate of [
    (h: any) => {
      h.status = "running";
    },
    (h: any) => {
      h.output.admitted.identity.producerVersion = "foreign";
    },
    (h: any) => {
      h.output.admitted.admittedAt++;
    },
    (h: any) => {
      h.output.proposal.text = "execute arbitrary code";
    },
    (h: any) => {
      h.output.proposal.receipt.submissionId = "other";
    },
    (h: any) => {
      h.output.proposal.receipt.uid = "other";
    },
    (h: any) => {
      h.output.proposal.before.reservedCents = 30;
    },
    (h: any) => {
      h.output.proposal.after.remainingCents++;
    },
    (h: any) => {
      h.output.proposal.after.reservations[0].id = "foreign";
    },
    (h: any) => {
      h.output.proposal.after.reservations[4].run = "other";
    },
    (h: any) => {
      h.output.proposal.after.reservations[4].id =
        h.output.proposal.after.reservations[0].id;
    },
  ]) {
    const h = incidentHistoryFixture();
    mutate(h);
    assert.throws(() =>
      incidentProposalFromHistory(h, h.output.proposal.after),
    );
  }
  let called = false;
  const h = incidentHistoryFixture();
  Object.defineProperty(h.output.proposal.after.reservations, "0", {
    get() {
      called = true;
      return {};
    },
  });
  assert.throws(() => incidentProposalFromHistory(h, h.output.proposal.after));
  assert.equal(called, false);
});
