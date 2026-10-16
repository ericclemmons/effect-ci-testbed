import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
// Original histories/version only: no clone, dispatch, token or deployment writes.
const enabled = process.env.LIVE_OWNED_GITLAB_SOURCE === "1";
const cf = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args, {
  encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
}));
const get = (label: string) => cf("workflows", "instances", "get", `coverage-owned-gitlab-${label}-20261015-1`,
  "--workflow-name", "effect-ci-gitlab-source-checks");
const repository = "https://gitlab.com/gitlab-org/gitlab-test.git", revision = "ddd0f15ae83993f5cb66a927a28673882e99100b";

test("standalone native GitLab clone restores pinned HEAD and VERSION without project execution", { skip: !enabled }, () => {
  const h = get("pinned");
  assert.equal(h.status, "complete"); assert.equal(h.versionId, "bab3fab3-7dd6-46c8-939e-8b6af8ff4755");
  assert.deepEqual(h.params, { repository, revision });
  assert.deepEqual(h.steps.map((s: { name: string }) => s.name), ["checkout-1", "checkout:commit-1",
    'command:["verify restored GitLab source",1]-1', "verify restored GitLab source:read-VERSION-1", "verify restored GitLab source:commit-1"]);
  assert.ok(h.steps.every((s: { success: boolean; attempts: unknown[] }) => s.success && s.attempts.length === 1));
  assert.equal(JSON.parse(h.steps[1].output).id, "4a3c9ebe-63e8-4608-b8ef-7c12f702250c");
  assert.deepEqual(JSON.parse(h.steps[2].output), { exitCode: 0, stderr: "", stdout: "" });
  assert.equal(h.steps[2].config.retries.limit, 0);
  assert.equal(h.steps[0].config.retries.limit, 5); // Existing transport policy; one actual attempt.
  assert.equal(h.steps[3].output, "6.7.0.pre\n");
  assert.equal(JSON.parse(h.steps[4].output).id, "63f16af7-f04a-439d-b64d-2cdff27c4f69");
  assert.equal(h.output.verified, true); assert.equal(h.output.revision, revision);
  assert.deepEqual(h.output.plan.nodes.map((n: { status: string }) => n.status), ["complete", "complete"]);
  assert.deepEqual(h.output.plan.nodes[1].commands, [{ command: `test "$(git rev-parse HEAD)" = ${revision}`, cwd: "/workspace/repository" }]);
  assert.ok(h.output.plan.nodes.every((n: { secrets: unknown[] }) => n.secrets.length === 0));
});

test("standalone native mutable revision fails before checkout or commands", { skip: !enabled }, () => {
  const h = get("mutable");
  assert.equal(h.status, "errored"); assert.equal(h.versionId, "bab3fab3-7dd6-46c8-939e-8b6af8ff4755");
  assert.deepEqual(h.params, { repository, revision: "master" }); assert.equal(h.steps.length, 0);
  assert.match(h.error.message, /Exact pinned public GitLab source required/);
});

test("recorded standalone GitLab deployment has no secrets, extra bindings or public URL", { skip: !enabled }, () => {
  const v = cf("workers", "versions", "get", "18a11254-debf-41e6-a6a4-f0e3dcbc7d39", "--worker-id", "effect-ci-gitlab-source");
  assert.deepEqual(v.bindings ?? [], []); assert.deepEqual(v.urls, []);
  assert.deepEqual(Object.keys(v.exports).sort(), ["GitLabSourceWorkflow", "WorkspaceContainer"]);
  assert.equal(v.containers.length, 1); assert.equal(v.containers[0].name, "effect-ci-gitlab-source-workspace");
  assert.ok(v.containers[0].images.workspace.endsWith("@sha256:7b2ede4459d6738f1465db630f3fe3794fd9c9ba28f8b5a9dffc3900b8df9924"));
});
