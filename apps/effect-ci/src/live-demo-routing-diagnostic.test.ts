import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("retained same-candidate native diagnostic measures convergence and restores without build/upload/approval", { skip: !process.env.LIVE_DEMO_ROUTING_DIAGNOSTIC }, () => {
  const read = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args, { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 }));
  // Only historical GETs; never create, reexecute, promote, approve or upload.
  const h = read("workflows", "instances", "get", "coverage-demo-routing-diagnostic-20261015-1", "--workflow-name", "effect-ci-demo-routing-diagnostic");
  assert.equal(h.status, "complete");
  assert.equal(h.success, true);
  assert.deepEqual(h.params, { mode: "observe-fixed-candidate" });
  assert.equal(h.trigger.source, "api", "operator diagnosis is not push-to-release acceptance");
  const steps = h.steps.filter((s: any) => s.type === "step");
  assert.equal(steps.length, 13);
  for (const s of steps) { assert.equal(s.success, true); assert.equal(s.attempts.length, 1); assert.equal(s.config.retries.limit, 0); }
  const value = (name: string) => { const s = steps.find((s: any) => s.name === `${name}-1`); assert.ok(s); assert.ok(s.output.length < 1024); assert.ok(!s.output.includes("[truncated output]")); return JSON.parse(s.output); };
  const prepared = value("routing:verify-prepared");
  assert.equal(prepared.uploadPerformed, false);
  assert.equal(prepared.revision, "cedd7e628d7d89f5a39d9267c8fb2f24adfdd4f6");
  assert.equal(prepared.version, "454d68b9-f3cb-4ffd-9dd7-6d8d8a6cca58");
  let requested = value("routing:baseline").requested;
  for (const [seconds, unkeyed, keyed] of [[0, 0, 0], [30, 5, 9], [120, 12, 4]]) {
    for (const [mode, expected] of [["unkeyed", unkeyed], ["keyed", keyed]]) {
      const cohort = value(`routing:probe-${mode}-${seconds}`);
      assert.equal(cohort.requested, 100); assert.equal(cohort.unknown, 0);
      assert.equal(cohort.counts.reduce((n: number, c: any) => n + c.trials, 0), 100);
      assert.equal(cohort.counts.find((c: any) => c.version === prepared.version).trials, expected);
      assert.ok(cohort.counts.every((c: any) => c.failures === 0));
      requested += cohort.requested;
    }
  }
  assert.equal(requested, 700);
  const restored = value("routing:restore");
  assert.equal(restored.status, "rolled-back");
  assert.equal(restored.deployment.id, "28046f81-3b35-47f7-9a19-02491e2bc5e1");
  assert.deepEqual(restored.deployment.versions, value("routing:claim").previous);
  assert.ok(!steps.some((s: any) => /command:|approve|commit|notification:/.test(s.name)));
  const original = read("workflows", "instances", "get", "a0c5ecb0-c8a9-11f1-97b4-737865af3839", "--workflow-name", "effect-ci-demo");
  assert.equal(original.status, "errored");
  assert.equal(original.params.revision, prepared.revision);
});
