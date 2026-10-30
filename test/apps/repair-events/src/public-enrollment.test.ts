import assert from "node:assert/strict";
import test from "node:test";
import { publicIncidentEnrollment } from "./public-enrollment.ts";
import { admitPublicIncident } from "../../../../packages/github/src/public-incident.ts";

test("host title matches observed WOBS token masking literally, never as a wildcard", () => {
  const p = { policy: "owned-public-http-repair-v1", service: "effect-ci-repair-incident",
    fixtureDigest: "6e3a3627b9fd217104ff0b7d73aba6968d2422558539af3aac2f5f2625ef6dd6",
    notificationPolicy: "a376288b467440058fc2f3d8dd0f0e3b", source: "23bdde6b7bd4924d13cb34666c484e3f6888e21b",
    version: "cd91c304-a8a1-48f5-97cf-ad60b7edb285", emission: "owned-public-health-500-v1",
    message: "Effect CI owned public health fixture returned 500 (<token>)" };
  // LOCAL synthetic transport/claim isolates the title contract observed on the
  // genuine public exception. This is NOT its private claim or native admission.
  const observedAt = Date.parse("2026-10-15T18:35:34.236Z"), claimedAt = observedAt - 1;
  const time = new Date(observedAt).toISOString();
  const issue = { id: "11111111-1111-1111-1111-111111111111", count: "1",
    type: "ISSUE_TYPE_EXCEPTION", status: "ISSUE_STATUS_ACTIVE",
    title: "Effect CI owned public health fixture returned 500 (<token>) · at publicFaultFetch (index.js)",
    first_observed: time, last_observed: time, services: [{ name: p.service,
      type: "SERVICE_TYPE_WORKER", first_observed: time, last_observed: time }] };
  const event = { alert_type: "workers_observability_real_time_issue", policy_id: p.notificationPolicy,
    alert_event: "ALERT_STATE_EVENT_START", alert_correlation_id: "22222222-2222-2222-2222-222222222222",
    data: { state_event: "ALERT_STATE_EVENT_START", state_correlation_id: "22222222-2222-2222-2222-222222222222", issue } };
  const claim = { emission: p.emission, version: p.version, currentVersion: p.version,
    fixtureDigest: p.fixtureDigest, claimedAt };
  assert.equal(admitPublicIncident(JSON.stringify(event), claim, p, observedAt + 1000).issue, issue.id);
  for (const text of ["arbitrary-token", "<redacted>", "owned-public-health-500-v1", "<token> extra"]) {
    const changed = structuredClone(event); changed.data.issue.title = issue.title.replace("<token>", text);
    assert.throws(() => admitPublicIncident(JSON.stringify(changed), claim, p, observedAt + 1000));
  }
  assert.throws(() => admitPublicIncident(JSON.stringify(event), claim, p, claimedAt + 300001));
  assert.throws(() => admitPublicIncident(JSON.stringify(event), { ...claim, claimedAt: observedAt + 1 }, p, observedAt + 1000));
});

test("work enrollment pins the independently deployed source version and destination policy", () => {
  assert.equal(publicIncidentEnrollment?.source, "600a0e6b2d1cdc5c3046e0cb606d1ad012acfdef");
  assert.equal(publicIncidentEnrollment?.version, "b0ef08f6-7f42-4928-b35d-da5d0d770c0e");
  assert.equal(publicIncidentEnrollment?.notificationPolicy, "f1f5f1a16aea488999a43099cc75ed03");
});
