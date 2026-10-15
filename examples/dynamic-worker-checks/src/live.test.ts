import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
// Read original histories/version only; never execute, dispatch or reformat.
const enabled = process.env.LIVE_OWNED_FORMATTER === "1";
const cf = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args, { encoding: "utf8", timeout: 30_000 }));
const get = (label: string) => cf("workflows", "instances", "get", `coverage-owned-isolate-${label}-20261015-1`, "--workflow-name", "effect-ci-source-formatter-checks");
const version = "5d2e54e3-c420-4763-9e84-9bce839cca15";
test("owned formatter uses actual WorkerLoader RPC and no Container", { skip: !enabled }, () => {
  const h = get("formatted"); assert.equal(h.status, "complete"); assert.equal(h.versionId, version);
  assert.deepEqual(h.params, { mode: "formatted" });
  assert.deepEqual(h.steps.map((s: { name: string }) => s.name), ["fixture:read-source-1", "isolated:format-1"]);
  assert.ok(h.steps.every((s: { success: boolean; attempts: unknown[]; config: { retries: { limit: number } } }) => s.success && s.attempts.length === 1 && s.config.retries.limit === 0));
  const result = JSON.parse(h.steps[1].output); assert.equal(result.runtime, "dynamic-worker");
  assert.deepEqual(result.files, { "app/src/index.ts": h.steps[0].output });
  assert.equal(h.output.containers, 0);
  assert.ok(h.output.plan.nodes.every((n: { status: string; commands: unknown[]; secrets: unknown[] }) => n.status === "complete" && n.commands.length === 0 && n.secrets.length === 0));
});
test("unformatted source remains errored after actual formatter success", { skip: !enabled }, () => {
  const h = get("unformatted"); assert.equal(h.status, "errored"); assert.equal(h.versionId, version);
  assert.deepEqual(h.params, { mode: "unformatted" }); assert.equal(h.steps.length, 2);
  assert.ok(h.steps.every((s: { success: boolean; attempts: unknown[] }) => s.success && s.attempts.length === 1));
  const result = JSON.parse(h.steps[1].output); assert.equal(result.runtime, "dynamic-worker");
  assert.notEqual(result.files["app/src/index.ts"], h.steps[0].output);
  assert.match(h.error.message, /is not formatted/);
});
test("extra actor source cannot enter the formatter fixture", { skip: !enabled }, () => {
  const h = get("formatter-extra"); assert.equal(h.status, "errored"); assert.equal(h.steps.length, 0);
  assert.match(h.error.message, /Exact owned formatter fixture mode required/);
});
test("recorded formatter host has only WorkerLoader and no container/storage exports", { skip: !enabled }, () => {
  const v = cf("workers", "versions", "get", "a104511a-1174-4389-89fd-0f4966d31787", "--worker-id", "effect-ci-source-formatter");
  assert.deepEqual(v.bindings, [{ name: "LOADER", type: "worker_loader" }]); assert.deepEqual(v.urls, []);
  assert.deepEqual(v.containers ?? [], []); assert.deepEqual(Object.keys(v.exports), ["FormatterWorkflow"]);
});
