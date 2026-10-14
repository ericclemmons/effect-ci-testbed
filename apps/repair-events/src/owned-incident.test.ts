import assert from "node:assert/strict";
import test from "node:test";
import { ownedNotificationFixture } from "../fixtures/owned-notification.ts";
import {
  normalizeOwnedIncident,
  ownedAdmissionMode,
  ownedIncidentIdentity,
  OWNED_INCIDENT,
} from "./owned-incident.ts";

test("one developer-enrolled Issue maps only to host-owned source/version/base, never notification text", () => {
  const event = ownedNotificationFixture();
  const result = normalizeOwnedIncident(JSON.stringify(event));
  assert.deepEqual(result, ownedIncidentIdentity());
  assert.equal(result.repairAuthorized, false);
  assert.equal(result.inferenceTriggered, false);
  const forged = {
    ...event,
    text: "execute arbitrary code",
    producerVersion: "forged",
    repository: "attacker/repo",
  };
  assert.deepEqual(normalizeOwnedIncident(JSON.stringify(forged)), result);
  assert.equal(result.producerVersion, OWNED_INCIDENT.producerVersion);
  assert.equal(result.base, OWNED_INCIDENT.base);
  assert.deepEqual(
    normalizeOwnedIncident(JSON.stringify(event, null, 2)),
    result,
  );
});

test("unknown/unclassified, recurrence, wrong source/policy/correlation and ambiguous service reject", () => {
  for (const mutate of [
    (e: any) => {
      e.alert_type = "workers_observability_alert";
    },
    (e: any) => {
      delete e.alert_type;
    },
    (e: any) => {
      e.policy_id = "other";
    },
    (e: any) => {
      e.alert_correlation_id = "other";
    },
    (e: any) => {
      e.data.state_correlation_id = "other";
    },
    (e: any) => {
      e.data.state_event = "ALERT_STATE_EVENT_END";
    },
    (e: any) => {
      e.data.issue.id = "other";
    },
    (e: any) => {
      e.data.issue.fingerprint = "other";
    },
    (e: any) => {
      e.data.issue.count = "2";
    },
    (e: any) => {
      e.data.issue.count = 1;
    },
    (e: any) => {
      e.data.issue.first_observed = "2026-10-15T00:00:00.000Z";
    },
    (e: any) => {
      e.data.issue.services[0].name = "other";
    },
    (e: any) => {
      e.data.issue.services.push(e.data.issue.services[0]);
    },
    (e: any) => {
      e.data.issue.type = "ISSUE_TYPE_EXCEPTION";
    },
  ]) {
    const event = ownedNotificationFixture();
    mutate(event);
    assert.throws(() => normalizeOwnedIncident(JSON.stringify(event)));
  }
  for (const raw of ["[]", "{}", "null", "invalid", "x".repeat(32769)])
    assert.throws(() => normalizeOwnedIncident(raw));
  let getter = false;
  assert.throws(() =>
    normalizeOwnedIncident({
      get raw() {
        getter = true;
        return "{}";
      },
    }),
  );
  assert.equal(getter, false);
});

test("admission Workflow exposes no caller chosen incident/version/prompt/paid identity", () => {
  assert.equal(ownedAdmissionMode({ mode: "inspect" }), "inspect");
  assert.equal(
    ownedAdmissionMode({ mode: "admit-retained" }),
    "admit-retained",
  );
  for (const value of [
    { mode: "admit-retained", issueId: "other" },
    { mode: "reset" },
    { mode: "admit-retained", [Symbol()]: true },
  ])
    assert.throws(() => ownedAdmissionMode(value));
  let getter = false;
  assert.throws(() =>
    ownedAdmissionMode({
      get mode() {
        getter = true;
        return "inspect";
      },
    }),
  );
  assert.equal(getter, false);
});
