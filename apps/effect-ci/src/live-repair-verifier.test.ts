import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test(
  "retained native exact-commit Node verification completed once and its owned check is successful",
  { skip: !process.env.LIVE_NATIVE_REPAIR_INSTANCE },
  () => {
    const id = process.env.LIVE_NATIVE_REPAIR_INSTANCE!;
    assert.equal(id, "coverage-owned-native-verifier-20261014-1");
    const run = JSON.parse(
      execFileSync(
        process.env.CF_BIN ?? "/Users/eric/Library/pnpm/bin/cf",
        [
          "workflows",
          "instances",
          "get",
          id,
          "--workflow-name",
          "effect-ci-owned-repair-verification",
        ],
        { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
      ),
    );
    assert.equal(run.status, "complete");
    assert.equal(run.success, true);
    assert.equal(run.versionId, "66dd6f78-1dbe-47a6-b50f-6969f9cbf8f3");
    assert.deepEqual(run.params, { mode: "verify-retained" });
    assert.equal(run.step_count, 1);
    const step = run.steps[0];
    assert.equal(step.name, "repair:verify-retained-exact-commit-1");
    assert.equal(step.success, true);
    assert.equal(step.config.retries.limit, 0);
    assert.equal(step.attempts.length, 1);
    assert.equal(step.attempts[0].success, true);
    const value = run.output;
    const commit = "bd9682e5b9ca5f8f696ea8052bd5afd4cd2c0a00";
    const digest = "55efeb6f1f64e6dd6f5db766664c08875c31b292ae79774d62d9a2a1fcde516d";
    assert.deepEqual(value, {
      commit,
      sourceDigest: digest,
      passed: true,
      evidenceId: "github_check_115744830965",
      environment: "native-node-container",
      commandExecuted: true,
      codeWritten: false,
      pullRequestCreated: false,
      deploymentPerformed: false,
    });
    assert.deepEqual(JSON.parse(step.output), {
      commit,
      sourceDigest: digest,
      passed: true,
      evidenceId: value.evidenceId,
    });
    const check = JSON.parse(
      execFileSync(
        "gh",
        ["api", "repos/ericclemmons/effect-ci-private-github-fixture/check-runs/115744830965"],
        { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
      ),
    );
    assert.equal(check.id, 115744830965);
    assert.equal(check.app.id, 5089816);
    assert.equal(check.head_sha, commit);
    assert.equal(check.status, "completed");
    assert.equal(check.conclusion, "success");
    assert.equal(check.name, "Effect CI repair / owned health check (native Node)");
    assert.equal(
      check.external_id,
      `owned-native-repair:friday-repair-20261013-1:${commit}:${digest}`,
    );
    assert.ok(
      check.output.summary.includes(
        "env -i PATH=/usr/local/bin:/usr/bin:/bin node --test repair-demo/health.test.mjs",
      ),
    );
    assert.ok(check.output.summary.includes("Actual native Node exit code: 0."));
  },
);
