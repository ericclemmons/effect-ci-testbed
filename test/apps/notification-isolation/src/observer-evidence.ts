import assert from "node:assert/strict";

// Test-only reader. An expected outcome is not proof of a different host/version.
export function verifyObserverHistory(h: any, mode: "observer-success" | "observer-business-failure",
  owner: string, workerVersion: string, workflowVersion: string) {
  assert.match(workerVersion, /^[a-f0-9-]{36}$/);
  assert.match(workflowVersion, /^[a-f0-9-]{36}$/);
  assert.equal(h.versionId, workflowVersion);
  assert.deepEqual(h.params, { mode });
  const failure = mode === "observer-business-failure", updates = failure ? 4 : 5;
  assert.equal(h.status, failure ? "errored" : "complete");
  for (const s of h.steps) {
    assert.equal(s.success, true);
    assert.equal(s.attempts.length, 1);
    assert.equal(s.attempts[0].success, true);
    assert.equal(s.config.retries.limit, 0);
  }
  const value = (name: string) => {
    const steps = h.steps.filter((s: any) => s.name === name + "-1");
    assert.equal(steps.length, 1);
    return JSON.parse(steps[0].output);
  };
  const status = value("observer-status");
  assert.deepEqual(status.invocations, { rejecting: 1, journal: updates });
  assert.equal(status.droppedEvents, 0);
  assert.equal(status.omittedReceipts, 0);
  assert.equal(status.receipts.length, updates * 2);
  for (const observer of ["rejecting", "journal"]) {
    const receipts = status.receipts.filter((r: any) => r.observer === observer);
    assert.equal(receipts.length, updates);
    receipts.forEach((r: any, i: number) => {
      assert.deepEqual(Object.keys(r).sort(), ["event", "observer", "sequence", "status"]);
      assert.equal(r.sequence, i + 1);
      assert.equal(r.status, observer === "journal" ? "delivered" : i === 0 ? "failed" : "blocked");
    });
    assert.equal(receipts.at(-1).event, "workflow.completed");
  }
  const journal = value("journal:final"), providers = value("provider-invocations");
  assert.equal(journal.owner, owner);
  assert.equal(journal.version, "worker-version:" + workerVersion);
  assert.equal(journal.updates, updates * 2);
  assert.equal(journal.snapshot.phase, failure ? "failure" : "success");
  assert.deepEqual(providers, { rejecting: 1, journal: updates });
  assert.equal(value("business-result").conclusion, journal.snapshot.phase);
  if (failure) assert.deepEqual(h.error, { message: "Original owned business failure", name: "Error" });
  else { assert.equal(h.output.value, "business succeeded"); assert.equal(h.output.workerVersion, workerVersion); }
  assert.ok(!JSON.stringify(status).includes("Owned notification destination rejected"));
}
