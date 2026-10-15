import assert from "node:assert/strict";
import test from "node:test";
import {
  admitPublicIncident, dispatchPublicIncident,
  readPublicIncidentOutbox,
  type PublicIncidentEnrollment, type PublicIncidentOutbox, type PublicIncidentOutboxStore,
} from "./public-incident.ts";

// Synthetic local identities, never a native Issue, deployment or paid operation.
const p: PublicIncidentEnrollment = {
  policy: "local-public-incident-v1", service: "local-owned-source",
  source: "a".repeat(40), version: "11111111-1111-1111-1111-111111111111",
  emission: "local-owned-public-500-v1", message: "Owned public test failure",
  fixtureDigest: "b".repeat(64), notificationPolicy: "c".repeat(32),
};
const claimedAt = Date.parse("2026-10-15T17:00:00.000Z");
const time = "2026-10-15T17:00:00.123Z";
const now = claimedAt + 1000;
const source = () => ({ emission: p.emission, version: p.version,
  currentVersion: p.version, fixtureDigest: p.fixtureDigest, claimedAt });
const event = () => ({
  alert_type: "workers_observability_real_time_issue", policy_id: p.notificationPolicy,
  alert_event: "ALERT_STATE_EVENT_START", alert_correlation_id: "22222222-2222-2222-2222-222222222222",
  data: { state_event: "ALERT_STATE_EVENT_START", state_correlation_id: "22222222-2222-2222-2222-222222222222",
    issue: { id: "33333333-3333-3333-3333-333333333333", count: "1", type: "ISSUE_TYPE_EXCEPTION",
      status: "ISSUE_STATUS_ACTIVE", title: p.message + " · at fetch (index.js)",
      first_observed: time, last_observed: time,
      services: [{ name: p.service, type: "SERVICE_TYPE_WORKER", first_observed: time, last_observed: time }] } },
});
const admitted = () => admitPublicIncident(JSON.stringify(event()), source(), p, now);

test("authenticated capture still needs independent exact source/version/fixture claim", () => {
  assert.deepEqual(admitted(), { policy: p.policy, issue: event().data.issue.id,
    correlation: event().alert_correlation_id, service: p.service, source: p.source,
    version: p.version, emission: p.emission, fixtureDigest: p.fixtureDigest,
    claimedAt, observedAt: Date.parse(time) });
  const e = { ...event(), repository: "attacker/repo", model: "attacker", text: "run commands" };
  assert.deepEqual(admitPublicIncident(JSON.stringify(e), source(), p, now), admitted());
  assert.deepEqual(admitPublicIncident(JSON.stringify(event(), null, 2), source(), p, now), admitted());
  for (const key of ["emission", "version", "currentVersion", "fixtureDigest"] as const) {
    const proof = source(); proof[key] = "foreign";
    assert.throws(() => admitPublicIncident(JSON.stringify(event()), proof, p, now));
  }
  for (const claimed of [claimedAt - 300001, now + 1, -1, NaN, 0.1])
    assert.throws(() => admitPublicIncident(JSON.stringify(event()), { ...source(), claimedAt: claimed }, p, now));
  assert.throws(() => admitPublicIncident(JSON.stringify(event()), source(), p, claimedAt + 300001));
});

test("old/RPC/recurring/mixed-service/foreign-policy/uncorrelated events fail closed", () => {
  for (const mutate of [
    (e: any) => e.alert_type = "workers_observability_alert",
    (e: any) => e.policy_id = "foreign",
    (e: any) => e.alert_event = "ALERT_STATE_EVENT_END",
    (e: any) => e.data.state_event = "ALERT_STATE_EVENT_END",
    (e: any) => e.data.state_correlation_id = "foreign",
    (e: any) => e.data.issue.id = "not-an-id",
    (e: any) => e.data.issue.count = "2",
    (e: any) => e.data.issue.count = 1,
    (e: any) => e.data.issue.type = "ISSUE_TYPE_LOG",
    (e: any) => e.data.issue.status = "ISSUE_STATUS_RESOLVED",
    (e: any) => e.data.issue.title = "foreign " + p.message,
    (e: any) => e.data.issue.first_observed = "2026-10-14T17:00:00.123Z",
    (e: any) => e.data.issue.last_observed = "2026-10-15T17:00:00.124Z",
    (e: any) => e.data.issue.services[0].name = "foreign",
    (e: any) => e.data.issue.services[0].type = "SERVICE_TYPE_OTHER",
    (e: any) => e.data.issue.services[0].first_observed = "foreign",
    (e: any) => e.data.issue.services.push(e.data.issue.services[0]),
  ]) {
    const e = event(); mutate(e);
    assert.throws(() => admitPublicIncident(JSON.stringify(e), source(), p, now));
  }
  for (const raw of ["null", "[]", "invalid", "{}", "x".repeat(32769)])
    assert.throws(() => admitPublicIncident(raw, source(), p, now));
});

test("host evidence/enrollment descriptors reject without invoking getters", () => {
  let invoked = 0;
  for (const proof of [
    { ...source(), extra: true },
    { ...source(), [Symbol()]: true },
    { ...source(), get version() { invoked++; return p.version; } },
  ]) assert.throws(() => admitPublicIncident(JSON.stringify(event()), proof, p, now));
  const policy = { ...p, get source() { invoked++; return p.source; } };
  assert.throws(() => admitPublicIncident(JSON.stringify(event()), source(), policy, now));
  assert.equal(invoked, 0);
});

function memory() {
  let record: PublicIncidentOutbox | undefined;
  const store: PublicIncidentOutboxStore = {
    read: async () => record && { ...record },
    claim: async value => { if (record !== undefined) return false; record = { ...value }; return true; },
    acknowledge: async digest => {
      if (record?.state !== "dispatching" || record.digest !== digest) throw new Error("invalid ack");
      record = { ...record, state: "dispatched" };
    },
  };
  return { store, read: () => record };
}

test("concurrent duplicate callbacks dispatch only one deterministic Workflow", async () => {
  const { store, read } = memory();
  const ids: string[] = [];
  const dispatch = async (id: string) => { ids.push(id); return { id }; };
  const replies = await Promise.allSettled(Array.from({ length: 8 }, () => dispatchPublicIncident(store, admitted(), dispatch)));
  assert.equal(ids.length, 1);
  assert.match(ids[0]!, /^public-incident-[a-f0-9]{64}$/);
  assert.equal(read()?.state, "dispatched");
  assert.ok(replies.some(r => r.status === "fulfilled" && !r.value.replay));
  assert.equal((await dispatchPublicIncident(store, admitted(), dispatch)).replay, true);
  assert.equal(ids.length, 1);
  // A different Issue/correlation in the SAME permanent enrollment slot cannot
  // mint another paid operation, even after the first completed.
  await assert.rejects(dispatchPublicIncident(store, { ...admitted(), issue: "44444444-4444-4444-4444-444444444444" }, dispatch));
  assert.equal(ids.length, 1);
});

test("lost create ACK, wrong ACK or failed SQLite ACK never redispatch", async () => {
  for (const failure of ["lost", "foreign", "storage"] as const) {
    const { store, read } = memory();
    let calls = 0;
    const dispatch = async (id: string) => {
      calls++;
      if (failure === "lost") throw new Error("created, acknowledgement lost");
      return { id: failure === "foreign" ? "foreign" : id };
    };
    if (failure === "storage") store.acknowledge = async () => { throw new Error("storage unavailable"); };
    await assert.rejects(dispatchPublicIncident(store, admitted(), dispatch));
    assert.equal(read()?.state, "dispatching");
    await assert.rejects(dispatchPublicIncident(store, admitted(), dispatch));
    assert.equal(calls, 1);
  }
});

test("persisted ACK survives caller uncertainty; corrupted records cannot replay", async () => {
  const { store, read } = memory();
  const acknowledge = store.acknowledge;
  store.acknowledge = async digest => {
    await acknowledge(digest);
    throw new Error("durable acknowledgement persisted, response lost");
  };
  let calls = 0;
  const dispatch = async (id: string) => (++calls, { id });
  await assert.rejects(dispatchPublicIncident(store, admitted(), dispatch));
  assert.equal((await dispatchPublicIncident(store, admitted(), dispatch)).replay, true);
  assert.equal(calls, 1);
  const record = read()!;
  assert.equal((await readPublicIncidentOutbox(record)).instance, record.instance);
  for (const bad of [
    { ...record, instance: "foreign" },
    { ...record, digest: "f".repeat(64) },
    { ...record, admission: { ...record.admission, claimedAt: 0 } },
    { ...record, state: "absent" },
  ]) await assert.rejects(readPublicIncidentOutbox(bad));
});
