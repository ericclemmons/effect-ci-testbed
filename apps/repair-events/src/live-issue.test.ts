import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

test(
  "retained real owned Issue matches its authenticated quarantined notification and native occurrence",
  { skip: !process.env.LIVE_OWNED_ISSUE },
  () => {
    const issueId = "e28e6b86-bea4-440f-8729-be6437e97293";
    assert.equal(process.env.LIVE_OWNED_ISSUE, issueId);
    const cf = (...args: string[]) =>
      JSON.parse(
        execFileSync(
          process.env.CF_BIN ?? "/Users/eric/Library/pnpm/bin/cf",
          args,
          {
            encoding: "utf8",
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
          },
        ),
      );
    const history = (id: string, workflow: string) => {
      const run = cf(
        "workflows",
        "instances",
        "get",
        id,
        "--workflow-name",
        workflow,
      );
      assert.equal(run.status, "complete");
      assert.equal(run.success, true);
      assert.equal(run.step_count, 1);
      assert.equal(run.steps[0].success, true);
      assert.equal(run.steps[0].config.retries.limit, 0);
      assert.equal(run.steps[0].attempts.length, 1);
      return run;
    };
    const emission = history(
      "coverage-owned-incident-emission-20261014-1",
      "effect-ci-owned-incident",
    );
    assert.equal(emission.versionId, "dd5fb0a6-5f42-4adc-bbd4-a0c8e7ef280c");
    assert.deepEqual(emission.params, { mode: "emit-once" });
    assert.deepEqual(JSON.parse(emission.steps[0].output), {
      emissionId: "friday-owned-health-500-v1",
      status: 500,
      replay: false,
      issueVerified: false,
    });
    // Preserve the actual outer RPC serialization discrepancy, not a rewritten receipt.
    assert.equal(emission.output.status, "unknown");
    const digest =
      "090b9a8ca33d048025f301270f0eb48d27a44ec2931306382d7de51fac5f9a58";
    const captured = history(
      "coverage-notification-read-owned-issue-20261014-1",
      "effect-ci-notification-inspection",
    );
    assert.equal(captured.versionId, "dbc674b6-e917-492b-8905-1f9ad4c91d79");
    assert.deepEqual(captured.params, { mode: "read", digest });
    const receipt = captured.output;
    assert.equal(receipt.digest, digest);
    assert.equal(receipt.quarantined, true);
    assert.equal(receipt.incidentDedupeVerified, false);
    assert.ok(Buffer.byteLength(receipt.raw) <= 32 * 1024);
    assert.equal(
      createHash("sha256").update(receipt.raw).digest("hex"),
      digest,
    );
    const envelope = JSON.parse(receipt.raw);
    assert.equal(envelope.alert_type, "workers_observability_real_time_issue");
    assert.equal(envelope.policy_id, "a376288b467440058fc2f3d8dd0f0e3b");
    assert.equal(envelope.alert_event, "ALERT_STATE_EVENT_START");
    const notification = envelope.data.issue;
    assert.equal(notification.id, issueId);
    assert.equal(notification.count, "1");
    assert.deepEqual(
      notification.services.map((service: { name: string }) => service.name),
      ["effect-ci-repair-incident"],
    );
    const { issue } = cf("o11y", "issues", "get", issueId);
    assert.equal(issue.service, "effect-ci-repair-incident");
    assert.equal(issue.fingerprint, notification.fingerprint);
    assert.equal(issue.firstObserved, Date.parse(notification.first_observed));
    const activity = issue.activity.find(
      (entry: { id: string }) =>
        entry.id === envelope.data.state_correlation_id,
    );
    assert.ok(activity);
    assert.equal(activity.automationId, "0d9ff5e2-b362-46bd-a33d-4640b46e18cc");
    assert.equal(activity.policyId, envelope.policy_id);
    assert.equal(activity.scope, "service");
    assert.equal(activity.status, "succeeded");
    const occurrences = cf(
      "o11y",
      "issues",
      "occurrences",
      issueId,
      "--per-page",
      "10",
    );
    const occurrence = occurrences.find(
      (entry: { id: string }) => entry.id === "01M4XA9MBZ0000000000000009",
    );
    assert.ok(occurrence);
    assert.equal(occurrence.timestamp, issue.firstObserved);
    assert.equal(occurrence.worker.scriptName, "effect-ci-repair-incident");
    assert.equal(occurrence.worker.entrypoint, "OwnedFaultOnce");
    assert.equal(
      occurrence.worker.scriptVersion.id,
      "20a3b050-574b-40fc-bf22-5d4086926484",
    );
    assert.equal(occurrence.invocation.type, "jsrpc");
    assert.equal(occurrence.error.mechanism, "structured-log");
    assert.equal(
      occurrence.error.message,
      "Effect CI owned health fixture returned 500 (friday-owned-health-500-v1)",
    );
    // This is read-only historical evidence, never incident admission or inference authority.
  },
);
