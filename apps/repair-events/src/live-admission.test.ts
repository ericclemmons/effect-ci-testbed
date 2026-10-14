import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { OWNED_INCIDENT, ownedIncidentIdentity } from "./owned-incident.ts";

test(
  "retained native owned admission and separate-checkpoint replay preserve one semantic identity without inference",
  { skip: !process.env.LIVE_OWNED_ADMISSION },
  () => {
    assert.equal(
      process.env.LIVE_OWNED_ADMISSION,
      "coverage-owned-admission-once-20261014-1",
    );
    const history = (
      id: string,
      workflow = "effect-ci-owned-incident-admission",
    ) => {
      const run = JSON.parse(
        execFileSync(
          process.env.CF_BIN ?? "/Users/eric/Library/pnpm/bin/cf",
          ["workflows", "instances", "get", id, "--workflow-name", workflow],
          { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
        ),
      );
      assert.equal(run.status, "complete");
      assert.equal(run.success, true);
      assert.equal(run.step_count, 1);
      assert.equal(run.steps[0].config.retries.limit, 0);
      assert.equal(run.steps[0].attempts.length, 1);
      assert.equal(run.steps[0].success, true);
      // CF's large raw-capture step preview is truncated; only the bounded
      // admission checkpoints are claimed as exact full step equality here.
      if (workflow === "effect-ci-owned-incident-admission")
        assert.deepEqual(JSON.parse(run.steps[0].output), run.output);
      return run;
    };
    const before = history("coverage-owned-admission-inspect-20261014-1");
    assert.deepEqual(before.params, { mode: "inspect" });
    assert.deepEqual(before.output, { state: "absent" });
    const first = history("coverage-owned-admission-once-20261014-1");
    const replay = history("coverage-owned-admission-replay-20261014-1");
    for (const run of [before, first, replay])
      assert.equal(run.versionId, "30dced3b-1769-4ed5-bb4c-f574f540d921");
    for (const run of [first, replay]) {
      assert.deepEqual(run.params, { mode: "admit-retained" });
      assert.deepEqual(run.output.identity, ownedIncidentIdentity());
      assert.equal(run.output.admittedAt, 1791992186246);
      assert.equal(run.output.incidentDedupeVerified, true);
      assert.equal(run.output.identity.inferenceTriggered, false);
      assert.equal(run.output.identity.repairAuthorized, false);
    }
    assert.equal(first.output.duplicate, false);
    assert.equal(replay.output.duplicate, true);
    assert.ok(Date.parse(before.end) < Date.parse(first.start));
    assert.ok(Date.parse(first.end) < Date.parse(replay.start));
    const captured = history(
      "coverage-notification-read-owned-issue-20261014-1",
      "effect-ci-notification-inspection",
    ).output;
    assert.equal(captured.quarantined, true);
    assert.equal(captured.incidentDedupeVerified, false);
    assert.equal(captured.digest, OWNED_INCIDENT.captureDigest);
    assert.equal(
      createHash("sha256").update(captured.raw).digest("hex"),
      captured.digest,
    );
    assert.equal(
      JSON.parse(captured.raw).data.issue.id,
      first.output.identity.issueId,
    );
    // Historical receipt equality is not current incident status, paid authority,
    // forced process restart, private-source parity or attested check reuse.
  },
);
