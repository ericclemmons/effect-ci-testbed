import assert from "node:assert/strict";
import test from "node:test";
import { verifyObserverHistory } from "./observer-evidence.ts";

test("synthetic observer-reader regressions are not hosted execution evidence", () => {
  const worker = "a".repeat(8) + "-aaaa-aaaa-aaaa-" + "a".repeat(12), version = worker.replaceAll("a", "b");
  for (const mode of ["observer-success", "observer-business-failure"] as const) {
    const failed = mode.endsWith("business-failure"), count = failed ? 4 : 5;
    const receipt = { invocations: { rejecting: 1, journal: count }, droppedEvents: 0, omittedReceipts: 0,
      receipts: Array.from({ length: count }, (_, i) => ["rejecting", "journal"].map(observer => ({
        sequence: i + 1, observer, event: i === count - 1 ? "workflow.completed" : "workflow.started",
        status: observer === "journal" ? "delivered" : i === 0 ? "failed" : "blocked" }))).flat() };
    const values = { "observer-status": receipt, "provider-invocations": { rejecting: 1, journal: count },
      "business-result": { conclusion: failed ? "failure" : "success" },
      "journal:final": { owner: "synthetic", version: "worker-version:" + worker, updates: count * 2,
        snapshot: { phase: failed ? "failure" : "success" } } };
    const h = { params: { mode }, versionId: version, status: failed ? "errored" : "complete",
      steps: Object.entries(values).map(([name, value]) => ({ name: name + "-1", output: JSON.stringify(value), success: true,
        attempts: [{ success: true }], config: { retries: { limit: 0 } } })),
      ...(failed ? { error: { message: "Original owned business failure", name: "Error" } } :
        { output: { value: "business succeeded", workerVersion: worker } }) };
    verifyObserverHistory(h, mode, "synthetic", worker, version);
    for (const mutate of [
      (v: any) => { v.versionId = worker; },
      (v: any) => { v.status = failed ? "complete" : "errored"; },
      (v: any) => { v.steps[0].success = false; },
      (v: any) => { v.steps[0].attempts.push({ success: true }); },
      (v: any) => { const p = JSON.parse(v.steps[0].output); p.invocations.rejecting = 2; v.steps[0].output = JSON.stringify(p); },
      (v: any) => { const p = JSON.parse(v.steps[0].output); p.receipts[0].error = "secret"; v.steps[0].output = JSON.stringify(p); },
      (v: any) => { const p = JSON.parse(v.steps[0].output); p.droppedEvents = 1; v.steps[0].output = JSON.stringify(p); },
    ]) { const invalid = structuredClone(h); mutate(invalid); assert.throws(() => verifyObserverHistory(invalid, mode, "synthetic", worker, version)); }
    assert.throws(() => verifyObserverHistory(h, mode, "foreign", worker, version));
  }
});
