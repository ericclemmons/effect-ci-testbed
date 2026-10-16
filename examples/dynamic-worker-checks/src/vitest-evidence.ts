import assert from "node:assert/strict";
import type { AssertionMode } from "./vitest-fixture.ts";

// Test-only acceptance reader. Synthetic regression inputs are not native proof.
export function verifyAssertionHistory(h: any, mode: AssertionMode, owner: string, version: string) {
  assert.match(version, /^[a-f0-9-]{36}$/);
  assert.equal(h.versionId, version);
  assert.deepEqual(h.params, { mode });
  const passing = mode === "passing" || mode === "state-isolation";
  assert.equal(h.status, passing ? "complete" : "errored");
  const reportStep = h.steps.find((s: any) => s.name === "isolated:vitest-subset-1");
  const verified = h.steps.find((s: any) => s.name === "fixture:verify-report-1");
  const read = (s: any) => {
    assert.ok(s, "Required successful checkpoint missing");
    assert.equal(s.success, true);
    assert.equal(s.attempts.length, 1);
    assert.equal(s.attempts[0].success, true);
    assert.equal(s.config.retries.limit, 0);
    return JSON.parse(s.output);
  };
  const report = read(reportStep);
  assert.deepEqual(read(verified), { mode, validated: true });
  assert.equal(report.runtime, "dynamic-worker");
  assert.equal(report.tool, "vitest-expect-5.0.3-subset");
  assert.equal(report.containers, 0);
  assert.match(report.toolDigest, /^[a-f0-9]{64}$/);
  assert.ok(Number.isInteger(report.toolBytes) && report.toolBytes > 0 && report.toolBytes <= 512 * 1024);
  assert.ok(Number.isInteger(report.toolModuleCount) && report.toolModuleCount > 0 && report.toolModuleCount <= 16);
  assert.equal(report.tests.length, mode === "state-isolation" ? 2 : 1);
  for (const t of report.tests) {
    assert.equal(t.passed, passing);
    assert.equal(t.assertions, mode === "passing" ? 3 : mode === "state-isolation" || mode === "assertion-failure" ? 1 : 0);
    if (!passing) assert.equal(t.failure, mode === "assertion-failure" ? "assertion" : "execution");
    else assert.equal(t.failure, undefined);
  }
  if (passing || mode === "cpu-loop") {
    const tail = read(h.steps.find((s: any) => s.name === "fixture:tail-outcomes-1"));
    assert.equal(tail.toolDigest, report.toolDigest);
    assert.equal(tail.outcomes.length, report.tests.length);
    tail.outcomes.forEach((v: any, index: number) => {
      assert.equal(v.owner, owner);
      assert.equal(v.test, index);
      assert.equal(v.outcome, mode === "cpu-loop" ? "exceededCpu" : "ok");
      for (const key of ["cpuTime", "wallTime", "eventTimestamp"]) assert.ok(Number.isFinite(v[key]) && v[key] >= 0);
    });
  }
  if (passing) assert.deepEqual(h.output, { mode, report, containers: 0 });
  else assert.match(h.error?.message ?? "", /Owned isolated project test failed/);
  return report.toolDigest as string;
}
