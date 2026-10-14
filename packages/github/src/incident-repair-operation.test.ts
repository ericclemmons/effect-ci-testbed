import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runIncidentRepair, incidentRepairDigest, assertIncidentRepairEvidence } from "./incident-repair-operation.ts";
import { INCIDENT_IDENTITY, INCIDENT_PROPOSAL_INSTANCE } from "./incident-proposal.ts";
import { INCIDENT_MODEL_RESERVATION, INCIDENT_MODEL_RUN, INCIDENT_MODEL_TEXT } from "./incident-evidence.ts";
import { FIXED_SOURCE } from "./repair.ts";
import { operationDigest, type OperationStore, type RepairResult } from "./repair-operation.ts";
const evidence = {
  instance: INCIDENT_PROPOSAL_INSTANCE, reservationId: INCIDENT_MODEL_RESERVATION,
  run: INCIDENT_MODEL_RUN, text: INCIDENT_MODEL_TEXT,
  issueId: INCIDENT_IDENTITY.issueId, operationId: INCIDENT_IDENTITY.operationId,
  activationPolicy: "host-owned-incident-proposal-only-v1",
};
const verified: RepairResult = {
  repository: INCIDENT_IDENTITY.repository, commit: "c".repeat(40),
  sourceDigest: createHash("sha256").update(FIXED_SOURCE).digest("hex"),
  evidenceId: "github_check_123", pullRequest: 3,
  url: `https://github.com/${INCIDENT_IDENTITY.repository}/pull/3`,
  created: true, deploymentPerformed: false,
};
function harness(initial?: unknown, lostAck = false) {
  let record: any = initial, reads = 0, writes = 0;
  const store: OperationStore = {
    read: async () => record,
    claim: async r => { if (record !== undefined) return false; record = r; return true; },
    complete: async (digest, value) => {
      assert.equal(record.state, "pending"); assert.equal(record.digest, digest);
      record = { ...record, state: "complete", result: value };
      if (lostAck) throw Error("ACK lost after storage");
    },
    fail: async digest => { assert.equal(record.digest, digest); if (record.state === "pending") record = { ...record, state: "failed" }; },
  };
  return { store, read: async () => { reads++; return evidence; },
    propose: async () => { writes++; assert.equal(record.state, "pending"); return verified; },
    counts: () => ({ reads, writes }), record: () => record };
}
test("new incident identity persists before acknowledgement; old pilot digest cannot replay", async () => {
  assert.notEqual(await incidentRepairDigest(), await operationDigest());
  const h = harness();
  const first = await runIncidentRepair(h.store, h.read, h.propose);
  assert.equal(first.replay, false); assert.equal(first.issueId, INCIDENT_IDENTITY.issueId);
  assert.equal(first.automaticWebhookActivation, false);
  const replay = await runIncidentRepair(h.store, () => { throw Error("No evidence read"); }, () => { throw Error("No writer"); });
  assert.equal(replay.replay, true); assert.equal(replay.created, false);
  assert.deepEqual(h.counts(), { reads: 1, writes: 1 });
  const old = harness({ version: 1, state: "complete", digest: await operationDigest(), result: verified });
  await assert.rejects(runIncidentRepair(old.store, old.read, old.propose));
  assert.deepEqual(old.counts(), { reads: 0, writes: 0 });
});
test("concurrent claims allow one writer; uncertain completion retains completed receipt", async () => {
  const h = harness();
  const settled = await Promise.allSettled(Array.from({ length: 8 }, () => runIncidentRepair(h.store, h.read, h.propose)));
  assert.equal(settled.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(h.counts().writes, 1);
  const lost = harness(undefined, true);
  await assert.rejects(runIncidentRepair(lost.store, lost.read, lost.propose));
  assert.equal(lost.record().state, "complete");
  assert.equal((await runIncidentRepair(lost.store, lost.read, lost.propose)).replay, true);
  assert.deepEqual(lost.counts(), { reads: 1, writes: 1 });
});
test("failed/pending operations never retry; foreign or old PR results never complete", async () => {
  const failed = harness();
  await assert.rejects(runIncidentRepair(failed.store, failed.read, async () => { throw Error("Uncertain write"); }));
  await assert.rejects(runIncidentRepair(failed.store, failed.read, failed.propose));
  assert.equal(failed.record().state, "failed"); assert.equal(failed.counts().reads, 1);
  const pending = harness({ version: 1, state: "pending", digest: await incidentRepairDigest() });
  await assert.rejects(runIncidentRepair(pending.store, pending.read, pending.propose));
  assert.deepEqual(pending.counts(), { reads: 0, writes: 0 });
  for (const changed of [{ pullRequest: 2 }, { repository: "foreign/repo" }, { sourceDigest: "0".repeat(64) }, { deploymentPerformed: true }]) {
    const h = harness();
    await assert.rejects(runIncidentRepair(h.store, h.read, async () => ({ ...verified, ...changed }) as RepairResult));
    assert.equal(h.record().state, "failed");
  }
});
test("descriptor-safe evidence and persisted state reject caller accessors and extra authority", async () => {
  let invoked = 0;
  const accessor = { ...evidence };
  Object.defineProperty(accessor, "text", { get() { invoked++; return evidence.text; } });
  assert.throws(() => assertIncidentRepairEvidence(accessor));
  assert.throws(() => assertIncidentRepairEvidence({ ...evidence, passed: true }));
  assert.throws(() => assertIncidentRepairEvidence({ ...evidence, issueId: "foreign" }));
  const state = { version: 1, state: "complete", digest: await incidentRepairDigest(), result: verified };
  Object.defineProperty(state, "result", { get() { invoked++; return verified; } });
  const h = harness(state);
  await assert.rejects(runIncidentRepair(h.store, h.read, h.propose));
  assert.equal(invoked, 0); assert.deepEqual(h.counts(), { reads: 0, writes: 0 });
});
