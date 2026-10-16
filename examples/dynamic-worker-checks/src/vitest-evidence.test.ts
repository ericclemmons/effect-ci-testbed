import assert from "node:assert/strict";
import test from "node:test";
import { assertionModes, type AssertionMode } from "./vitest-fixture.ts";
import { verifyAssertionHistory } from "./vitest-evidence.ts";

const version = "11111111-1111-4111-8111-111111111111";
function synthetic(mode: AssertionMode): any {
  const passing = mode === "passing" || mode === "state-isolation";
  const report = { runtime: "dynamic-worker", tool: "vitest-expect-5.0.3-subset", containers: 0,
    toolDigest: "a".repeat(64), toolBytes: 1024, toolModuleCount: 1,
    tests: Array.from({ length: mode === "state-isolation" ? 2 : 1 }, () => ({ name: "synthetic",
      passed: passing, assertions: mode === "passing" ? 3 : mode === "state-isolation" || mode === "assertion-failure" ? 1 : 0,
      ...(!passing ? { failure: mode === "assertion-failure" ? "assertion" : "execution" } : {}) })) };
  const checkpoint = (name: string, output: unknown) => ({ name: `${name}-1`, success: true,
    attempts: [{ success: true }], config: { retries: { limit: 0 } }, output: JSON.stringify(output) });
  return { versionId: version, params: { mode }, status: passing ? "complete" : "errored",
    steps: [checkpoint("isolated:vitest-subset", report), checkpoint("fixture:verify-report", { mode, validated: true }),
      ...(passing || mode === "cpu-loop" ? [checkpoint("fixture:tail-outcomes", { toolDigest: report.toolDigest,
        outcomes: report.tests.map((_, i) => ({ owner: "synthetic-owner", test: i,
          outcome: mode === "cpu-loop" ? "exceededCpu" : "ok", cpuTime: 1, wallTime: 2, eventTimestamp: 3 })) })] : [])],
    ...(passing ? { output: { mode, report, containers: 0 } } : { error: { message: "Owned isolated project test failed" } }) };
}
test("synthetic acceptance-reader regressions are not native execution evidence", () => {
  for (const mode of assertionModes) verifyAssertionHistory(synthetic(mode), mode, "synthetic-owner", version);
});
test("CPU timeout alone, missing journal, foreign owner and wrong version cannot pass", () => {
  for (const change of [
    (h: any) => { h.steps.pop(); },
    (h: any) => { const t = JSON.parse(h.steps[2].output); t.outcomes[0].outcome = "canceled"; h.steps[2].output = JSON.stringify(t); },
    (h: any) => { const t = JSON.parse(h.steps[2].output); t.outcomes[0].owner = "foreign"; h.steps[2].output = JSON.stringify(t); },
    (h: any) => { h.versionId = "22222222-2222-4222-8222-222222222222"; },
    (h: any) => { h.error.message = "Workflow step timed out"; },
    (h: any) => { h.steps[0].attempts.push({ success: true }); },
    (h: any) => { h.steps[1].success = false; },
    (h: any) => { h.status = "complete"; },
  ]) {
    const h = synthetic("cpu-loop"); change(h);
    assert.throws(() => verifyAssertionHistory(h, "cpu-loop", "synthetic-owner", version));
  }
});
