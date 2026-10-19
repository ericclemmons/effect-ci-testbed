import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const enabled = process.env.LIVE_DEMO_SITE_CAPACITY === "1";
const cf = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args,
  { encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }));
const revisions = ["105ce02b81915f845df75cbc20ecc383162b54f6", "4ae41a23fa6a0978c5f58ec60a135b07fc5addd2"];
test("retained native inspection proves full registry and unchanged records after finite retention fix", { skip: !enabled }, () => {
  for (const [id, version, capacity] of [
    ["owned-site-inspection-20261016-1", "3dcc6cee-2dfa-4625-ba54-011444644419", 32],
    ["owned-site-capacity-readback-20261016-1", "1e66c0b8-2bcd-4327-868b-4502e7d71ef8", 256],
  ] as const) {
    const h = cf("workflows", "instances", "get", id, "--workflow-name", "effect-ci-demo-site-inspection");
    assert.equal(h.status, "complete"); assert.equal(h.versionId, version); assert.deepEqual(h.params, {});
    assert.equal(h.steps.length, 1); const step = h.steps[0];
    assert.equal(step.name, "registry:read-metadata-1"); assert.equal(step.success, true);
    assert.equal(step.attempts.length, 1); assert.equal(step.attempts[0].success, true); assert.equal(step.config.retries.limit, 0);
    assert.deepEqual(h.output, JSON.parse(step.output));
    assert.deepEqual(h.output, revisions.map((revision, index) => ({ revision, count: 32, capacity, present: index === 0 })));
  }
});
test("retained native site versions preserve private capabilities without secrets or Containers", { skip: !enabled }, () => {
  for (const id of ["afd1cf7a-1789-46d6-8c27-30d223d25bfd", "57e58f82-cada-4808-95d0-89f210cba9e5"]) {
    const v = cf("workers", "versions", "get", id, "--worker-id", "effect-ci-demo-site");
    assert.equal(v.id, id); assert.deepEqual(v.bindings ?? [], []); assert.deepEqual(v.containers ?? [], []);
    assert.deepEqual(Object.keys(v.exports).sort(), ["DemoSitePublisher", "DemoSiteRevisions", "SiteInspectionWorkflow"]);
  }
});
