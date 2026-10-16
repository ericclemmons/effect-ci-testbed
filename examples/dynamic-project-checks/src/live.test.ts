import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
// Original read-only records; no child execution, dispatch, reset or deployment.
const enabled = process.env.LIVE_OWNED_PROJECT === "1";
const cf = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args, { encoding: "utf8", timeout: 30_000 }));
const get = (label: string) => cf("workflows", "instances", "get", `coverage-owned-isolate-${label}-20261015-1`, "--workflow-name",
  label === "boundaries" ? "effect-ci-owned-project-boundaries" : "effect-ci-owned-project-checks");
test("owned native multi-module project checks complete without Containers", { skip: !enabled }, () => {
  const h = get("project"); assert.equal(h.status, "complete"); assert.equal(h.versionId, "287f8698-c6f6-4e65-975d-56618bfbe3f5");
  assert.deepEqual(h.params, { mode: "fixture" });
  assert.deepEqual(h.steps.map((s: { name: string }) => s.name), ["fixture:read:app/index.js-1", "fixture:read:app/lib.js-1", "isolated:project-checks-1"]);
  assert.ok(h.steps.every((s: { success: boolean; attempts: unknown[]; config: { retries: { limit: number } } }) => s.success && s.attempts.length === 1 && s.config.retries.limit === 0));
  assert.deepEqual(h.output.proof, { runtime: "dynamic-worker", passed: ["module behavior", "bindings withheld", "outbound denied", "unknown route"], containers: 0 });
  assert.equal(h.output.containers, 0);
  assert.ok(h.output.plan.nodes.every((n: { status: string; commands: unknown[]; secrets: unknown[] }) => n.status === "complete" && n.commands.length === 0 && n.secrets.length === 0));
});
test("owned native hostile modules retain network/binding/state/output/CPU fences", { skip: !enabled }, () => {
  const h = get("boundaries"); assert.equal(h.status, "complete"); assert.equal(h.versionId, "a9e59f5a-be15-4ba1-9fbf-9653d112617f");
  assert.deepEqual(h.params, { mode: "verify-boundaries" });
  assert.deepEqual(h.steps.map((s: { name: string }) => s.name), ["boundary:network-1", "boundary:bindings-1", "boundary:fresh-globals-1",
    "boundary:host-filesystem-1", "boundary:mismatch-1", "boundary:oversized-1", "boundary:cpu-1"]);
  assert.ok(h.steps.every((s: { success: boolean; attempts: unknown[]; config: { retries: { limit: number } } }) => s.success && s.attempts.length === 1 && s.config.retries.limit === 0));
  const r = h.output.results;
  for (const key of ["network", "bindings", "host-filesystem"]) assert.deepEqual(r[key], { runtime: "dynamic-worker", passed: ["boundary"], containers: 0 });
  assert.deepEqual(r["fresh-globals"].passed, ["boundary", "fresh globals"]);
  for (const key of ["mismatch", "oversized", "cpu"]) { assert.equal(r[key].rejected, true); assert.equal(r[key].policyCpuMs, 50); assert.equal(r[key].containers, 0); }
  assert.equal(r.cpu.modulePreflightPassed, true); assert.ok(r.cpu.elapsedMs < 4000); // Parent clock, not measured CPU time.
  assert.equal(h.output.containers, 0);
});
test("extra caller modules fail before a source read or child invocation", { skip: !enabled }, () => {
  const h = get("project-extra"); assert.equal(h.status, "errored"); assert.equal(h.steps.length, 0);
  assert.match(h.error.message, /Exact owned project fixture mode required/);
});
test("recorded project host has WorkerLoader only and no Container/storage exports", { skip: !enabled }, () => {
  const v = cf("workers", "versions", "get", "abb69881-68f0-42d7-b34a-de5ced629a7f", "--worker-id", "effect-ci-project-checks");
  assert.deepEqual(v.bindings, [{ name: "LOADER", type: "worker_loader" }]); assert.deepEqual(v.urls, []);
  assert.deepEqual(v.containers ?? [], []); assert.deepEqual(Object.keys(v.exports).sort(), ["ProjectBoundaryWorkflow", "ProjectWorkflow"]);
});
