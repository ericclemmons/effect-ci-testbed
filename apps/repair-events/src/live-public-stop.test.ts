import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { admitPublicIncident, type PublicIncidentEnrollment } from "../../../packages/github/src/public-incident.ts";

test("retained public fetch exception reached authenticated capture and stopped before paid dispatch", {
  skip: process.env.LIVE_PUBLIC_INCIDENT_STOP !== "1",
}, () => {
  const cf = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args, {
    encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024,
  }));
  const history = (id: string, workflow: string) => {
    const h = cf("workflows", "instances", "get", id, "--workflow-name", workflow);
    assert.equal(h.status, "complete"); assert.equal(h.step_count, 1);
    assert.equal(h.steps[0].config.retries.limit, 0); assert.equal(h.steps[0].attempts.length, 1);
    assert.equal(h.steps[0].attempts[0].success, true);
    return h;
  };
  // Historical enrollment is immutable here: later legitimate host releases
  // must not rewrite which producer and policy this original failure exercised.
  const policy: PublicIncidentEnrollment = {
    policy: "owned-public-http-repair-v1", service: "effect-ci-repair-incident",
    source: "23bdde6b7bd4924d13cb34666c484e3f6888e21b",
    version: "cd91c304-a8a1-48f5-97cf-ad60b7edb285", emission: "owned-public-health-500-v1",
    message: "Effect CI owned public health fixture returned 500 (<token>)",
    fixtureDigest: "6e3a3627b9fd217104ff0b7d73aba6968d2422558539af3aac2f5f2625ef6dd6",
    notificationPolicy: "a376288b467440058fc2f3d8dd0f0e3b",
  };
  const armed = history("coverage-public-incident-arm-20261015-1", "effect-ci-public-incident-arm");
  assert.deepEqual(armed.params, { mode: "arm-public-once" });
  assert.equal(armed.output.producerVersion, policy.version); assert.equal(armed.output.source, policy.source);
  const source = history("coverage-public-source-inspect-20261015-1", "effect-ci-notification-inspection");
  assert.deepEqual(source.params, { mode: "public-source" });
  assert.equal(source.output.readOnly, true); assert.equal(source.output.inferenceCalled, false);
  const proof = source.output.producer;
  assert.equal(proof.version, policy.version); assert.equal(proof.currentVersion, policy.version);
  assert.equal(proof.fixtureDigest, policy.fixtureDigest);
  const captured = history("coverage-public-notification-read-20261015-1", "effect-ci-notification-inspection");
  const digest = "6b8db9c0e57110c87d886df30b61164540695be5746f4ba110ef533b1e54ea1c";
  assert.deepEqual(captured.params, { mode: "read", digest });
  const receipt = captured.output;
  assert.equal(createHash("sha256").update(receipt.raw).digest("hex"), digest);
  assert.equal(receipt.quarantined, true); assert.equal(receipt.incidentDedupeVerified, false);
  const envelope = JSON.parse(receipt.raw);
  const issueId = "a077ace1-d3b3-4c70-83eb-7e2178164871";
  assert.equal(envelope.data.issue.id, issueId); assert.equal(envelope.data.issue.type, "ISSUE_TYPE_EXCEPTION");
  const { issue } = cf("observability", "issues", "get", issueId);
  assert.equal(issue.service, policy.service);
  assert.equal(issue.firstObserved, Date.parse(envelope.data.issue.first_observed));
  const occurrences = cf("observability", "issues", "occurrences", issueId, "--per-page", "10");
  const occurrence = occurrences.find((r: any) => r.id === "01M50DJ8EW0000000000000006");
  assert.ok(occurrence); assert.equal(occurrence.worker.scriptVersion.id, policy.version);
  assert.equal(occurrence.invocation.type, "fetch"); assert.equal(occurrence.invocation.method, "GET");
  assert.equal(occurrence.invocation.path, "/failure"); assert.equal(occurrence.invocation.rayId, "a4b0eca26a48dad6");
  assert.equal(occurrence.error.mechanism, "exception"); assert.equal(occurrence.error.handled, false);
  // Pure diagnosis using the ACTUAL original delivery timestamp, NOT a changed
  // native clock, admission mutation, replay or authority to dispatch anything.
  const admitted = admitPublicIncident(receipt.raw, proof, policy, receipt.receivedAt);
  assert.equal(admitted.observedAt - admitted.claimedAt, 37);
  assert.throws(() => admitPublicIncident(receipt.raw, proof, {
    ...policy, message: "Effect CI owned public health fixture returned 500 (owned-public-health-500-v1)",
  }, receipt.receivedAt));
  assert.throws(() => admitPublicIncident(receipt.raw, proof, policy, proof.claimedAt + 300001));
  const budget = (id: string) => {
    const h = history(id, "effect-ci-repair-budget-probe"); assert.deepEqual(h.params, { mode: "inspect" });
    assert.equal(h.output.inferenceCalled, false);
    // This bounded complete JSON is <1024B; never parse a truncated large preview.
    assert.ok(Buffer.byteLength(h.steps[0].output) < 1024);
    return JSON.parse(h.steps[0].output);
  };
  const before = budget("coverage-public-repair-budget-preflight-20261015-1");
  const after = budget("coverage-public-repair-budget-postfailure-20261015-1");
  assert.deepEqual(after, before); assert.equal(after.reservedCents, 50);
  assert.equal(after.reservations.length, 5);
  // No URL hit, Workflow creation, activation, reset, model call or GitHub write.
});
