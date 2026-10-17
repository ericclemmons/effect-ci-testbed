import assert from "node:assert/strict";
import test from "node:test";
import { boundedBody, eligibleJob, MAX_BODY, RUNNER_LABEL, trustedRun, validEnrollment, webhookJob, type Enrollment } from "./policy.ts";

const policy: Enrollment = { enabled: true, appId: 1, installationId: 2, repositoryId: 3,
  repository: "fixture/private", runnerGroupId: 1, lifetimeSeconds: 900 };
const job = { id: 4, run_id: 5, run_attempt: 1, head_sha: "a".repeat(40), status: "queued", conclusion: null, labels: [RUNNER_LABEL] };
const repository = { id: 3, full_name: policy.repository, private: true };
const event = { action: "queued", installation: { id: 2 }, repository, workflow_job: job };
const run = { id: 5, run_attempt: 1, head_sha: job.head_sha, event: "push", repository, head_repository: repository };

test("admission is pinned to the enabled host's installation, private repository and exact label", () => {
  assert.ok(validEnrollment(policy));
  const admitted = webhookJob(event, policy)!;
  assert.deepEqual(admitted, { id: 4, runId: 5, attempt: 1, sha: job.head_sha });
  for (const change of [{ enabled: false }, { appId: 0 }, { installationId: -1 }, { repositoryId: NaN },
    { lifetimeSeconds: 299 }, { lifetimeSeconds: 1801 }, { repository: "../escape" }])
    assert.equal(webhookJob(event, { ...policy, ...change }), undefined);
  for (const change of [{ action: "completed" }, { action: "in_progress" }, { installation: { id: 99 } },
    { repository: { ...repository, private: false } }, { repository: { ...repository, id: 99 } },
    { repository: { ...repository, full_name: "other/private" } }])
    assert.equal(webhookJob({ ...event, ...change }, policy), undefined);
  for (const change of [{ id: 0 }, { run_id: 0 }, { run_attempt: 0 }, { head_sha: "main" },
    { conclusion: "success" }, { status: "completed" }, { labels: ["self-hosted"] },
    { labels: [RUNNER_LABEL, "linux"] }, { labels: [] }])
    assert.equal(eligibleJob({ ...job, ...change }, policy), undefined);
  for (const input of [null, [], 1, "event"]) assert.equal(webhookJob(input, policy), undefined);
  assert.ok(trustedRun(run, admitted, policy));
  for (const change of [{ event: "pull_request" }, { event: "pull_request_target" }, { event: "workflow_dispatch" },
    { run_attempt: 2 }, { head_sha: "b".repeat(40) }, { head_repository: { ...repository, id: 99 } },
    { repository: { ...repository, private: false } }])
    assert.equal(trustedRun({ ...run, ...change }, admitted, policy), false);
});

test("actual streamed bytes, encoding and UTF-8 are bounded before signature parsing", async () => {
  const req = (body: string | Uint8Array, headers = {}) => new Request("https://local.invalid/", { method: "POST", body: typeof body === "string" ? body : new Uint8Array(body).buffer, headers });
  assert.equal(await boundedBody(req("{}")), "{}");
  await assert.rejects(boundedBody(req("a".repeat(MAX_BODY + 1))));
  await assert.rejects(boundedBody(req("{}", { "content-encoding": "gzip" })));
  await assert.rejects(boundedBody(req(new Uint8Array([0xff]))));
});
