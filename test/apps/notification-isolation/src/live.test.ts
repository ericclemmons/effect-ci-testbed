import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const enabled = process.env.LIVE_NOTIFICATION_ISOLATION === "1";
const worker = "effect-ci-provider-isolation", version = "f1afbab9-a7d7-4d8f-94c8-81ef2c38320e";
const read = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args,
  { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));

// Retained GET-only proof. Never dispatch, retry, reset or redeploy for evidence.
for (const [mode, updates] of [["success", 5], ["business-failure", 4], ["provider-timeout", 5]] as const) {
  test(`native optional delivery preserves ${mode} and its independent healthy journal`, { skip: !enabled }, () => {
    const id = `owned-provider-${mode}-20261016-1`;
    const h = read("workflows", "instances", "get", id, "--workflow-name", worker);
    assert.deepEqual(h.params, { mode });
    assert.equal(h.status, mode === "business-failure" ? "errored" : "complete");
    const outputs = h.steps.filter((s: any) => s.success && s.output)
      .map((s: any) => ({ name: s.name, value: JSON.parse(s.output) }));
    const value = (name: string) => outputs.find((o: any) => o.name === name + "-1")?.value;
    const journal = value("journal:final"), invocations = value("provider-invocations");
    assert.equal(journal.owner, id); assert.equal(journal.version, "worker-version:" + version);
    assert.equal(journal.updates, updates); assert.equal(invocations.journal, updates);
    assert.equal(invocations.rejecting, 1);
    assert.equal(journal.snapshot.phase, mode === "business-failure" ? "failure" : "success");
    assert.equal(value("business-result").conclusion, journal.snapshot.phase);
    const deliveries = outputs.filter((o: any) => o.name.startsWith("delivery-status:")).map((o: any) => o.value);
    assert.equal(deliveries.length, updates);
    for (const receipt of deliveries) {
      assert.deepEqual(receipt.deliveries.find((d: any) => d.provider === "rejecting"), { provider: "rejecting", status: "failed" });
      assert.deepEqual(receipt.deliveries.find((d: any) => d.provider === "journal"),
        { provider: "journal", status: "delivered", receipt: { message: id } });
    }
    for (const s of h.steps) { assert.equal(s.attempts.length, 1); assert.equal(s.config.retries.limit, 0); }
    assert.deepEqual(h.steps.filter((s: any) => !s.success).map((s: any) => s.name),
      mode === "provider-timeout" ? ["provider:rejecting:1-1"] : []);
    if (mode === "business-failure") assert.deepEqual(h.error, { message: "Original owned business failure", name: "Error" });
    else { assert.equal(h.output.value, "business succeeded"); assert.equal(h.output.workerVersion, version); }
    assert.ok(!JSON.stringify(outputs).includes("Owned notification destination rejected"));
  });
}

test("recorded native fixture version is private and has no credential or external service binding", { skip: !enabled }, () => {
  const v = read("workers", "versions", "get", version, "--worker-id", worker);
  assert.deepEqual(v.urls, []);
  assert.deepEqual(v.bindings, [{ name: "WORKER_METADATA", type: "version_metadata" }]);
  assert.deepEqual(v.exports, { DeliveryJournal: { type: "durable-object", storage: "sqlite" },
    ProviderIsolation: { type: "workflow", name: worker }, RejectingDestination: { type: "worker" } });
});
