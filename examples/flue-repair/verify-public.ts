import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, URL } from "node:url";

// Reads retained real evidence only. Never emits, dispatches, infers, repairs or deploys.
const root = fileURLToPath(new URL("../../", import.meta.url));
const { publicProposalFromHistory, publicBudget } = await import(
  root + "/packages/github/src/public-proposal.ts"
);
const cf = process.env.CF_BIN ?? root + "/apps/effect-ci/node_modules/.bin/cf";
const read = (...args: string[]) =>
  JSON.parse(
    execFileSync(cf, args, {
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
const gh = (path: string) =>
  JSON.parse(
    execFileSync("gh", ["api", path], {
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
const instance = "public-incident-7a661383b6ee262fb99c597774c25674ba25046989b3a01e4092706614407849",
  issueId = "52da6a3f-87f0-49cd-865d-c7d7030a169b";
const history = (id: string, workflow: string) =>
  read("workflows", "instances", "get", id, "--workflow-name", workflow);
const original = history(instance, "effect-ci-public-incident-repair");
assert.equal(original.status, "errored");
assert.deepEqual(original.params, { mode: "repair-public" });
const failed = original.steps.find((s) => s.name === "public:propose-native-verified-pr-1");
assert.equal(failed.success, false);
assert.equal(failed.attempts.length, 1);
assert.equal(failed.config.retries.limit, 0);
const proposal = history(instance, "effect-ci-public-incident-proposal");
assert.equal(proposal.status, "complete");
assert.deepEqual(proposal.params, { mode: "proposal" });
for (const s of proposal.steps) {
  assert.equal(s.success, true);
  assert.equal(s.attempts.length, 1);
  assert.equal(s.config.retries.limit, 0);
}
const snapshot = history(
  "coverage-public-event-budget-after-20261015-1",
  "effect-ci-repair-budget-probe",
);
assert.equal(snapshot.status, "complete");
assert.ok(snapshot.steps[0].output.length < 1024);
const ledger = JSON.parse(snapshot.steps[0].output);
const entries = publicBudget(ledger);
assert.equal(entries.size, 6);
assert.equal(ledger.reservedCents, 60);
assert.equal(ledger.remainingCents, 640);
const e = await publicProposalFromHistory(instance, proposal, proposal.output.admitted, ledger);
assert.equal(e.admission.issue, issueId);
assert.equal(e.admission.emission, "owned-public-health-500-v2");
assert.equal(e.admission.source, "f8eb61a874ccf972fceed25ed6889978608d87bc");
assert.equal(proposal.output.proposal.before.reservations.length, 5);
assert.equal(proposal.output.proposal.after.reservations.length, 6);
const captureHistory = history(
  "coverage-public-event-inspect-read-20261015-2",
  "effect-ci-notification-inspection",
);
assert.equal(captureHistory.status, "complete");
const full = read(
  "workflows",
  "instances",
  "step",
  "get",
  "coverage-public-event-inspect-read-20261015-2",
  "--workflow-name",
  "effect-ci-notification-inspection",
  "--name",
  captureHistory.steps[0].name,
  "--type",
  "step",
);
const value = full.result ?? full;
assert.equal(value.status, "complete");
const capture = typeof value.output === "string" ? JSON.parse(value.output) : value.output;
assert.equal(capture.digest, "6416223b570e22dcb26b42e62db329aa9f24dce1ff2bd277d52aea2bdb47bfa6");
assert.equal(createHash("sha256").update(capture.raw).digest("hex"), capture.digest);
assert.equal(capture.quarantined, true);
assert.equal(capture.incidentDedupeVerified, false);
const event = JSON.parse(capture.raw);
assert.equal(event.alert_type, "workers_observability_real_time_issue");
assert.equal(event.policy_id, "a376288b467440058fc2f3d8dd0f0e3b");
assert.equal(event.alert_correlation_id, e.admission.correlation);
assert.equal(event.data.issue.id, issueId);
assert.equal(event.data.issue.count, "1");
assert.equal(Date.parse(event.data.issue.first_observed), e.admission.observedAt);
assert.ok(capture.receivedAt >= e.admission.observedAt);
assert.ok(capture.receivedAt - e.admission.claimedAt < 5 * 60 * 1000);
const occurrences = read("observability", "issues", "occurrences", issueId, "--per-page", "10");
assert.equal(occurrences.length, 1);
const occurrence = occurrences[0];
assert.equal(occurrence.worker.scriptName, "effect-ci-repair-incident");
assert.equal(occurrence.worker.scriptVersion.id, "9c829b54-985d-4811-b806-690f93338284");
assert.equal(occurrence.invocation.type, "fetch");
assert.equal(occurrence.invocation.method, "GET");
assert.equal(occurrence.invocation.path, "/failure");
assert.equal(occurrence.timestamp, e.admission.observedAt);
assert.equal(occurrence.error.message, "Effect CI public health check failed");
const repo = "ericclemmons/effect-ci-private-github-fixture",
  commit = "390e1eb0fb1c29263a3ec329c6db9049b881c66a",
  base = "352327387f610d84282a567bf9a40ceee3978950";
const pr = gh(`repos/${repo}/pulls/4`);
assert.equal(pr.state, "open");
assert.equal(pr.merged, false);
assert.equal(pr.user.id, 334321206);
assert.equal(pr.user.type, "Bot");
assert.equal(pr.head.sha, commit);
assert.equal(pr.base.ref, "demo/friday-repair");
assert.equal(pr.base.sha, base);
assert.equal(pr.head.ref, "codex/repair-public-" + issueId.replaceAll("-", ""));
const check = gh(`repos/${repo}/check-runs/116806821705`);
assert.equal(check.app.id, 5089816);
assert.equal(check.head_sha, commit);
assert.equal(check.status, "completed");
assert.equal(check.conclusion, "success");
assert.equal(check.name, "Effect CI repair / owned health check (native Node)");
assert.ok(check.output.summary.includes("Actual native Node exit code: 0."));
assert.ok(
  check.output.summary.includes(
    "env -i PATH=/usr/local/bin:/usr/bin:/bin node --test repair-demo/health.test.mjs",
  ),
);
assert.ok(Date.parse(check.completed_at) <= Date.parse(pr.created_at));
assert.ok(pr.body.includes("github_check_116806821705"));
assert.ok(pr.body.includes(commit));
const comparison = gh(`repos/${repo}/compare/${base}...${commit}`);
assert.equal(comparison.files.length, 1);
assert.equal(comparison.files[0].filename, "repair-demo/health.js");
assert.equal(comparison.files[0].status, "modified");
const content = gh(`repos/${repo}/contents/repair-demo/health.js?ref=${commit}`);
assert.equal(
  Buffer.from(content.content, "base64").toString("utf8"),
  "export function healthStatus() { return 200; }\n",
);
const reconciliation = history(
  "coverage-public-pr-reconciliation-20261015-1",
  "effect-ci-owned-repair-verification",
);
assert.equal(reconciliation.status, "complete");
assert.deepEqual(reconciliation.params, { mode: "reconcile-public-pr" });
assert.equal(reconciliation.steps.length, 2);
for (const s of reconciliation.steps) {
  assert.equal(s.success, true);
  assert.equal(s.attempts.length, 1);
  assert.equal(s.config.retries.limit, 0);
}
const r = reconciliation.output;
assert.equal(r.pullRequest, 4);
assert.equal(r.commit, commit);
assert.equal(r.originalState, "failed");
assert.equal(r.originalWorkflowStatus, "errored");
for (const k of [
  "created",
  "newInferenceCalled",
  "commandExecuted",
  "codeWritten",
  "pullRequestCreated",
  "deploymentPerformed",
])
  assert.equal(r[k], false);
const oldCard = JSON.parse(original.steps.find((s) => s.name === "public:card-0-1").output);
assert.equal(r.slackTs, oldCard.ts);
console.log(
  JSON.stringify(
    {
      verified: true,
      issue: issueId,
      automaticProposal: instance,
      nativeCommit: commit,
      nativeCheck: 116806821705,
      proposedPR: pr.html_url,
      prState: "OPEN UNMERGED",
      originalAutomaticWorkflow: "ERRORED after creating PR; retained",
      operatorReconciliation: "COMPLETE; existing artifacts read only",
      sameSlackCard: r.slackTs,
      newCallsDuringVerification: 0,
      retainedReservations: 6,
      repairDeployed: false,
    },
    null,
    2,
  ),
);
