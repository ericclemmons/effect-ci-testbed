import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
test(
  "retained native writer proposed one exact verified PR and completed replay created nothing",
  { skip: !process.env.LIVE_NATIVE_WRITER_INSTANCE },
  () => {
    assert.equal(
      process.env.LIVE_NATIVE_WRITER_INSTANCE,
      "coverage-native-repair-proposal-20261014-1",
    );
    const cli = process.env.CF_BIN ?? "/Users/eric/Library/pnpm/bin/cf";
    const history = (id: string, workflow = "effect-ci-owned-repair-proposal") =>
      JSON.parse(
        execFileSync(cli, ["workflows", "instances", "get", id, "--workflow-name", workflow], {
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        }),
      );
    const run = history(process.env.LIVE_NATIVE_WRITER_INSTANCE!);
    const replay = history("coverage-native-repair-replay-20261014-1");
    for (const value of [run, replay]) {
      assert.equal(value.status, "complete");
      assert.equal(value.success, true);
      assert.equal(value.versionId, "a8bacca1-939b-4822-81c0-2fb761ca61f4");
      assert.equal(value.step_count, 1);
      assert.equal(value.steps[0].name, "repair:propose-retained-native-flue-1");
      assert.equal(value.steps[0].success, true);
      assert.equal(value.steps[0].config.retries.limit, 0);
      assert.equal(value.steps[0].attempts.length, 1);
      assert.equal(value.steps[0].attempts[0].success, true);
      assert.deepEqual(JSON.parse(value.steps[0].output), value.output);
    }
    const expected = {
      repository: "ericclemmons/effect-ci-private-github-fixture",
      commit: "08b74a4688844a26be097ea28f9706c7a7b35a79",
      sourceDigest: "55efeb6f1f64e6dd6f5db766664c08875c31b292ae79774d62d9a2a1fcde516d",
      evidenceId: "github_check_115785356860",
      pullRequest: 2,
      url: "https://github.com/ericclemmons/effect-ci-private-github-fixture/pull/2",
      created: true,
      deploymentPerformed: false,
      replay: false,
      modelInstance: "coverage-flue-proposal-20261014-1",
      modelReservationId: "flue_9215338e5c51bb55f8926ef9bcfb3186f4e970f83639929024685ab2ce2df43e",
      workersIssuesVerified: false,
    };
    assert.deepEqual(run.output, expected);
    assert.deepEqual(replay.output, { ...expected, created: false, replay: true });
    const api = (path: string) =>
      JSON.parse(
        execFileSync("gh", ["api", `repos/${expected.repository}/${path}`], {
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        }),
      );
    const pr = api("pulls/2"),
      check = api("check-runs/115785356860"),
      files = api("pulls/2/files");
    assert.equal(pr.user.login, "effect-ci-testbed[bot]");
    assert.equal(pr.state, "open");
    assert.equal(pr.merged, false);
    assert.equal(pr.head.sha, expected.commit);
    assert.equal(pr.head.ref, "codex/repair-friday-native-repair-20261014-1");
    assert.equal(pr.base.ref, "demo/friday-repair");
    assert.ok(pr.body.includes(expected.evidenceId));
    assert.equal(check.app.id, 5089816);
    assert.equal(check.head_sha, expected.commit);
    assert.equal(check.status, "completed");
    assert.equal(check.conclusion, "success");
    assert.ok(
      Date.parse(check.completed_at) <= Date.parse(pr.created_at),
      "native check completed before proposed PR",
    );
    assert.equal(files.length, 1);
    assert.equal(files[0].filename, "repair-demo/health.js");
    assert.equal(files[0].additions, 1);
    assert.equal(files[0].deletions, 1);
    assert.ok(files[0].patch.includes("-export function healthStatus() { return 500; }"));
    assert.ok(files[0].patch.includes("+export function healthStatus() { return 200; }"));
    const budget = history(
      "coverage-flue-budget-after-writer-20261014-1",
      "effect-ci-flue-proposal-probe",
    );
    assert.equal(budget.status, "complete");
    assert.equal(budget.output.inferenceCalled, false);
    assert.equal(budget.output.before.reservedCents, 40);
    assert.equal(budget.output.before.remainingCents, 660);
    assert.equal(budget.output.before.reservations.length, 4);
    assert.equal(budget.output.before.reservations[3].id, expected.modelReservationId);
  },
);
