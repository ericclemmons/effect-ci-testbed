import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("retained native incident writer and independent exact-commit Check/PR, no redispatch", {
  skip: !process.env.LIVE_INCIDENT_WRITER,
}, () => {
  assert.equal(process.env.LIVE_INCIDENT_WRITER, "coverage-owned-incident-writer-proposal-20261014-1");
  const read = (bin: string, args: string[]) => JSON.parse(execFileSync(bin, args,
    { encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 }));
  const history = (id: string, workflow = "effect-ci-owned-incident-repair") => read(
    process.env.CF_BIN ?? "cf", ["workflows", "instances", "get", id, "--workflow-name", workflow]);
  const proposal = history(process.env.LIVE_INCIDENT_WRITER!);
  const replay = history("coverage-owned-incident-writer-replay-20261014-1");
  for (const h of [proposal, replay]) {
    assert.equal(h.status, "complete"); assert.equal(h.success, true);
    assert.equal(h.steps.length, 1); assert.equal(h.steps[0].attempts.length, 1);
    assert.equal(h.steps[0].config.retries.limit, 0);
    assert.deepEqual(JSON.parse(h.steps[0].output), h.output);
    assert.equal(h.output.commit, "979958bfbe39d5d560dd94a73a51220d981c6900");
    assert.equal(h.output.issueId, "e28e6b86-bea4-440f-8729-be6437e97293");
    assert.equal(h.output.modelInstance, "owned-issue-flue-e28e6b86-v1");
    assert.equal(h.output.evidenceId, "github_check_116140407284");
    assert.equal(h.output.pullRequest, 3); assert.equal(h.output.deploymentPerformed, false);
    assert.equal(h.output.automaticWebhookActivation, false);
  }
  assert.equal(proposal.output.created, true); assert.equal(proposal.output.replay, false);
  assert.equal(replay.output.created, false); assert.equal(replay.output.replay, true);
  const prefix = "repos/ericclemmons/effect-ci-private-github-fixture";
  const check = read("gh", ["api", `${prefix}/check-runs/116140407284`]);
  const pr = read("gh", ["api", `${prefix}/pulls/3`]);
  assert.equal(check.app.id, 5089816); assert.equal(check.head_sha, proposal.output.commit);
  assert.equal(check.status, "completed"); assert.equal(check.conclusion, "success");
  assert.match(check.output.summary, /Actual native Node exit code: 0/);
  assert.ok(Date.parse(check.completed_at) < Date.parse(pr.created_at));
  assert.equal(pr.state, "open"); assert.equal(pr.merged, false);
  assert.equal(pr.head.sha, proposal.output.commit);
  assert.equal(pr.base.sha, "352327387f610d84282a567bf9a40ceee3978950");
  const files = read("gh", ["api", `${prefix}/pulls/3/files`]);
  assert.equal(files.length, 1); assert.equal(files[0].filename, "repair-demo/health.js");
  assert.equal(files[0].additions, 1); assert.equal(files[0].deletions, 1);
  const budget = history("coverage-incident-writer-budget-after-20261014-1", "effect-ci-flue-proposal-probe");
  assert.equal(budget.status, "complete"); assert.equal(budget.output.inferenceCalled, false);
  assert.equal(budget.output.before.reservedCents, 50); assert.equal(budget.output.before.remainingCents, 650);
  assert.equal(budget.output.before.reservations.length, 5);
});
