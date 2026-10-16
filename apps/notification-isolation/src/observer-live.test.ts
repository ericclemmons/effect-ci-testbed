import { execFileSync } from "node:child_process";
import test from "node:test";
import { verifyObserverHistory } from "./observer-evidence.ts";
import assert from "node:assert/strict";

// GET-only, pinned from independent native deployment/instance receipts.
const enabled = process.env.LIVE_RUNTIME_OBSERVERS === "1";
const workerVersion = "b9589e8e-abd8-4041-94f3-277adadbf0ab", workflowVersion = "66191594-d09e-435b-867c-767556b0c74f";
const read = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args,
  { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
for (const mode of ["observer-success", "observer-business-failure"] as const) {
  test(`retained native generic runtime ${mode}`, { skip: !enabled }, () => {
    const owner = "owned-" + mode + "-20261016-1";
    const h = read("workflows", "instances", "get", owner, "--workflow-name", "effect-ci-provider-isolation");
    verifyObserverHistory(h, mode, owner, workerVersion, workflowVersion);
  });
}
test("recorded generic-observer Worker has no public URL or credential/external binding", { skip: !enabled }, () => {
  const v = read("workers", "versions", "get", workerVersion, "--worker-id", "effect-ci-provider-isolation");
  assert.equal(v.id, workerVersion);
  assert.deepEqual(v.urls, []);
  assert.deepEqual(v.bindings, [{ name: "WORKER_METADATA", type: "version_metadata" }]);
  assert.deepEqual(v.exports, { DeliveryJournal: { type: "durable-object", storage: "sqlite" },
    ProviderIsolation: { type: "workflow", name: "effect-ci-provider-isolation" }, RejectingDestination: { type: "worker" } });
});
