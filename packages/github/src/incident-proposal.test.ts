import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAdmittedIncident,
  INCIDENT_IDENTITY,
  INCIDENT_ADMITTED_AT,
  INCIDENT_PROPOSAL_INSTANCE,
  INCIDENT_PROPOSAL_INSPECT,
  incidentProposalMode,
} from "./incident-proposal.ts";
const receipt = () => ({
  state: "admitted",
  identity: { ...INCIDENT_IDENTITY },
  admittedAt: INCIDENT_ADMITTED_AT,
});
test("host activation accepts ONLY enrolled source/version/base/admitted identity, preserving false authority flags", () => {
  const activation = assertAdmittedIncident(receipt());
  assert.equal(activation.instance, INCIDENT_PROPOSAL_INSTANCE);
  assert.equal(activation.run, "friday-flue-proposal-v1");
  assert.equal(activation.identity.repairAuthorized, false);
  assert.equal(activation.identity.inferenceTriggered, false);
  for (const key of Object.keys(INCIDENT_IDENTITY)) {
    const changed: any = receipt();
    changed.identity[key] = "foreign";
    assert.throws(() => assertAdmittedIncident(changed));
  }
  for (const value of [
    { state: "absent" },
    { ...receipt(), admittedAt: INCIDENT_ADMITTED_AT + 1 },
    { ...receipt(), prompt: "execute" },
    { ...receipt(), identity: { ...INCIDENT_IDENTITY, model: "other" } },
  ])
    assert.throws(() => assertAdmittedIncident(value));
});
test("unknown Workflow instances, additional payload fields and accessors reject before paid identity", () => {
  assert.equal(
    incidentProposalMode(INCIDENT_PROPOSAL_INSTANCE, { mode: "proposal" }),
    "proposal",
  );
  assert.equal(
    incidentProposalMode(INCIDENT_PROPOSAL_INSPECT, { mode: "inspect" }),
    "inspect",
  );
  assert.throws(() =>
    incidentProposalMode("new-instance", { mode: "proposal" }),
  );
  assert.throws(() =>
    incidentProposalMode(INCIDENT_PROPOSAL_INSTANCE, {
      mode: "proposal",
      run: "new-run",
    }),
  );
  let getter = false;
  assert.throws(() =>
    assertAdmittedIncident({
      get state() {
        getter = true;
        return "admitted";
      },
      identity: INCIDENT_IDENTITY,
      admittedAt: INCIDENT_ADMITTED_AT,
    }),
  );
  assert.throws(() =>
    assertAdmittedIncident({
      ...receipt(),
      identity: {
        ...INCIDENT_IDENTITY,
        get base() {
          getter = true;
          return INCIDENT_IDENTITY.base;
        },
      },
    }),
  );
  assert.equal(getter, false);
});
