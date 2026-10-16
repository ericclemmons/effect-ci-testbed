import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
// Original read-only evidence. No writes, fixture dispatch, reset or deployment.
const enabled = process.env.LIVE_OWNED_DO_SOURCE === "1";
const cf = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args, {
  encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
}));
const get = (label: string) => cf("workflows", "instances", "get", `coverage-owned-do-${label}-20261015-1`,
  "--workflow-name", label === "boundaries" ? "effect-ci-durable-source-boundaries" : "effect-ci-durable-source-checks");
const revision = "c79e699009991bf593f593ae81b03241c6de16447d4598ba66bee96d8b2eeed9";

test("native initial write and idempotent replay restore the same bytes into downstream Node", { skip: !enabled }, () => {
  const snapshots: string[] = [];
  for (const label of ["first", "replay"]) {
    const run = get(label);
    assert.equal(run.status, "complete");
    assert.equal(run.versionId, "3fa07039-ff94-4757-b384-338dc63d7986");
    assert.deepEqual(run.params, { repository: "owned-source", revision });
    assert.deepEqual(run.output.seed, { revision, created: label === "first" });
    assert.deepEqual(run.steps.map((s: { name: string }) => s.name), [
      "source:seed-owned-1", "source:durable-object-1", "checkout:commit-1",
      "verify restored DO bytes:read-source-txt-1", 'command:["verify restored DO bytes",1]-1', "verify restored DO bytes:commit-1",
    ]);
    assert.ok(run.steps.every((s: { success: boolean; attempts: unknown[] }) => s.success && s.attempts.length === 1));
    for (const i of [0, 1, 4]) assert.equal(run.steps[i].config.retries.limit, 0);
    assert.equal(run.steps[2].config.retries.limit, 5); // Ordinary transport policy, no actual retry.
    snapshots.push(JSON.parse(run.steps[2].output).id);
    assert.equal(run.steps[3].output, "source from durable object\n");
    const command = JSON.parse(run.steps[4].output);
    assert.equal(command.exitCode, 0); assert.equal(command.stderr, "");
    assert.deepEqual(JSON.parse(command.stdout), { verified: true, bytes: 27,
      sha256: "b87a3e3edf1d9c3dc8f24a2450b03131caa72452434477a17ad947f3b8ac2d1a", storageCredentialsPresent: false });
    assert.equal(run.output.verified, true);
    assert.deepEqual(run.output.plan.nodes.map((n: { status: string }) => n.status), ["complete", "complete"]);
  }
  assert.equal(snapshots[0], "b5973ee4-ffc9-4703-97ff-15c3f57c3cea");
  assert.notEqual(snapshots[0], snapshots[1]);
});

test("native separate fixture objects reject content conflicts, overflow and persisted corruption", { skip: !enabled }, () => {
  const run = get("boundaries");
  assert.equal(run.status, "complete");
  assert.equal(run.versionId, "4cba0ea0-3839-47b3-a971-49a913b4fc7c");
  assert.deepEqual(run.params, { mode: "verify-owned-boundaries" });
  assert.deepEqual(run.output, { bounds: { initialCreated: true, replayCreated: false, conflictRejected: true,
    revisions: 32, overflowRejected: true, fullStoreReplayCreated: false, originalReadable: true },
    corruption: { rejected: true, reason: "Source digest mismatch" }, materializationPerformed: false });
  assert.deepEqual(run.steps.map((s: { name: string }) => s.name), ["source:verify-owned-bounds-1", "source:verify-owned-corruption-1"]);
  assert.ok(run.steps.every((s: { success: boolean; attempts: unknown[]; config: { retries: { limit: number } } }) =>
    s.success && s.attempts.length === 1 && s.config.retries.limit === 0));
});

test("native foreign source is errored before a write or materialization step", { skip: !enabled }, () => {
  const run = get("foreign");
  assert.equal(run.status, "errored"); assert.equal(run.steps.length, 0);
  assert.match(run.error.message, /Fixed immutable source parameters required/);
});

test("recorded deployment has only owned private SQLite/Workflow exports and no environment capabilities", { skip: !enabled }, () => {
  const v = cf("workers", "versions", "get", "ddced780-6e9d-4403-bfb8-53b5c9227a7e", "--worker-id", "effect-ci-durable-source");
  assert.deepEqual(v.bindings ?? [], []); assert.deepEqual(v.urls, []);
  assert.deepEqual(Object.keys(v.exports).sort(), ["DurableSourceWorkflow", "SourceBoundaryWorkflow", "SourceIntegrityFixture", "SourceRevisions", "WorkspaceContainer"]);
  assert.equal(v.containers.length, 1);
  assert.ok(v.containers[0].images.workspace.endsWith("@sha256:33bf1e72342987c991bd0aa0ade227e70b0d1e9135d68577fe1b6deeddc4a9fd"));
});
