import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

// Read-only original histories/version. No create, upload, deploy or container run.
const enabled = process.env.LIVE_OWNED_R2_SOURCE === "1";
const cf = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args, {
  encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
}));
const get = (label: string) => cf("workflows", "instances", "get",
  `coverage-owned-r2-${label}-20261015-1`, "--workflow-name", "effect-ci-r2-source-checks");
const workflowVersion = "531ad0b6-25ae-4ae9-8321-7d27db9ff741";
const digest = "6759fef7f59ccbd363fb8c42062fb4903d98070d08da56c6ae873d9a75ea41cd";

test("owned R2 host reads its binding and verifies real restored bytes in native Node", { skip: !enabled }, () => {
  const run = get("valid");
  assert.equal(run.status, "complete");
  assert.equal(run.versionId, workflowVersion);
  assert.deepEqual(run.params, { repository: `source/${digest}.json`, revision: digest });
  assert.deepEqual(run.steps.map((s: { name: string }) => s.name), [
    "source:r2-1", "checkout:commit-1", "verify restored R2 bytes:read-source-txt-1",
    'command:["verify restored R2 bytes",1]-1', "verify restored R2 bytes:commit-1",
  ]);
  assert.ok(run.steps.every((s: { success: boolean; attempts: unknown[] }) => s.success && s.attempts.length === 1));
  assert.deepEqual(JSON.parse(run.steps[0].output), { key: `source/${digest}.json`, digest, files: 1 });
  assert.equal(run.steps[0].config.retries.limit, 0);
  assert.equal(JSON.parse(run.steps[1].output).id, "f1182bd5-39a3-479d-b7cb-ec3a525843fe");
  assert.equal(run.steps[2].output, "source from r2\n");
  const command = JSON.parse(run.steps[3].output);
  assert.equal(command.exitCode, 0);
  assert.equal(command.stderr, "");
  assert.equal(run.steps[3].config.retries.limit, 0);
  assert.deepEqual(JSON.parse(command.stdout), { verified: true, bytes: 15,
    sha256: "de72ee64a002cd0c9d99b35ec1e79a009a0fd73602831346f477d5837041c04f",
    storageCredentialsPresent: false });
  assert.equal(JSON.parse(run.steps[4].output).id, "03e83964-6fa7-4e78-bfe4-e1ec1804ee27");
  assert.equal(run.output.verified, true);
  assert.equal(run.output.storageCredentialsGivenToContainer, false);
  assert.deepEqual(run.output.plan.nodes.map((n: { status: string }) => n.status), ["complete", "complete"]);
  // Transport keeps its existing retry policy; all actual steps ran once.
  assert.equal(run.steps[1].config.retries.limit, 5);
});

for (const [label, message] of [
  ["wrong-digest", "Source digest mismatch"], ["missing", "R2 source not found"], ["unsafe", "Invalid source path"],
] as const) test(`owned R2 ${label} fails before checkout commit or downstream execution`, { skip: !enabled }, () => {
  const run = get(label);
  assert.equal(run.status, "errored");
  assert.equal(run.versionId, workflowVersion);
  assert.equal(run.steps.length, 1);
  assert.equal(run.steps[0].name, "source:r2-1");
  assert.equal(run.steps[0].success, false);
  assert.equal(run.steps[0].attempts.length, 1);
  assert.equal(run.steps[0].config.retries.limit, 0);
  assert.equal(run.error.message, message);
});

test("recorded owned Worker has only its private R2 capability and minimal image", { skip: !enabled }, () => {
  const version = cf("workers", "versions", "get", "41539d8a-2f86-4934-9052-b892ac0e7246", "--worker-id", "effect-ci-r2-source");
  assert.deepEqual(version.bindings, [{ bucket_name: "effect-ci-r2-source-input", name: "SOURCE_BUCKET", type: "r2_bucket" }]);
  assert.deepEqual(Object.keys(version.exports).sort(), ["R2SourceWorkflow", "WorkspaceContainer"]);
  assert.deepEqual(version.urls, []);
  assert.equal(version.containers.length, 1);
  assert.equal(version.containers[0].name, "effect-ci-r2-source-workspace");
  assert.ok(version.containers[0].images.workspace.endsWith("@sha256:33bf1e72342987c991bd0aa0ade227e70b0d1e9135d68577fe1b6deeddc4a9fd"));
});
