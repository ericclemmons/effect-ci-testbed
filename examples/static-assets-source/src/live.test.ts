import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { staticAssetsCsp } from "@effect-ci-testbed/cloudflare/static-assets-publish";

const enabled = process.env.LIVE_OWNED_STATIC_ASSETS === "1";
const current = enabled && process.env.LIVE_OWNED_STATIC_ASSETS_CURRENT === "1";
const workflow = "effect-ci-static-assets-publish";
const source = "5ba5791b4c200b5554d862709aa8b4fb458eaed8";
const originalSource = "2d8fadbde6213a901b786ec6c6e113c0c3786e5a";
const version = "2d544397-ed8a-4854-8e79-c27477f424a2";
const deployment = "f3821b11-46e2-4498-8c87-14790bbaeac9";
const originalVersion = "459e2853-ea87-4761-a1d8-59f10a4637dc";
const originalDeployment = "5dd11350-9244-4cad-8ae5-6efc412a0bc4";
const assetDigest = "b7925dc7d7bbfa859ad010af1d560a73fb1e5b0b75acda26d00d371ed6121f00";
const manifestDigest = "ecce5e4934c71fdbf6b6610dc0c83bb84d83fa32be73397521ee9f81dfe1dbf4";
const moduleDigest = "8d8bab86810c11d4124f8157b0a1f8ac0ebf3e9259102a128c09038d9893f711";
const origin = "https://effect-ci-static-assets-demo.ericclemmons.workers.dev";
const files = {
  "app.js": { bytes: 155, sha256: "04e45504d1fdebd8f1755a60f5f724cf90ecbd78b416e838f8fbe947862098f3" },
  "index.html": { bytes: 488, sha256: "50231495240495e60e9ca7507edcd49875fcef9bf3e9e1a10e25b2f52b994edb" },
  "style.css": { bytes: 199, sha256: "abf055f579e0ddcd56c05edbc179a24af73074d0b2e427f9b405e5602fd38aed" },
};
// This file can GET retained history, version metadata, allocation and public assets only.
// It never creates an instance, mints a GitHub token, uploads/deploys, or reads a secret file.
const read = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args, {
  encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
}));
const history = (id: string) => read("workflows", "instances", "get", id, "--workflow-name", workflow);
const stepsOnce = (value: any) => {
  for (const step of value.steps.filter((s: any) => s.type === "step")) {
    assert.equal(step.attempts.length, 1); assert.equal(step.config.retries.limit, 0); assert.equal(step.config.timeout, "2 minutes");
  }
};

test("retained normal native publication completes three actions without Container commands", { skip: !enabled }, () => {
  const h = history("coverage-owned-static-assets-fixed-20261015-1");
  assert.equal(h.status, "complete"); assert.equal(h.output.containers, 0);
  assert.equal(h.output.plan.environment, "cloudflare"); assert.equal(h.output.plan.nodes.length, 3);
  assert.ok(h.output.plan.nodes.every((node: any) => node.status === "complete" && node.commands.length === 0));
  assert.deepEqual(h.steps.map((s: any) => s.name), ["source:capture-immutable-1", "assets:upload-and-deploy-1", "assets:fixed-convergence-1", "assets:verify-served-bytes-1"]);
  stepsOnce(h);
  assert.deepEqual(h.output.receipt, { revision: source, manifestDigest, assetDigest, version, deployment, target: "effect-ci-static-assets-demo", policy: "owned-static-assets-v1" });
  const checked = read("workers", "versions", "get", version, "--worker-id", "effect-ci-static-assets-demo");
  assert.equal(checked.annotations["workers/commit_sha"], source);
  assert.equal(checked.annotations["workers/message"], `effect-ci-static:${assetDigest}:${moduleDigest}`);
  assert.deepEqual(checked.bindings, [{ name: "ASSETS", type: "assets" }]);
});

test("original errored history remains; separate GET-only recovery completed the same version", { skip: !enabled }, () => {
  const failed = history("coverage-owned-static-assets-20261015-1");
  assert.equal(failed.status, "errored"); assert.equal(failed.steps.length, 2); stepsOnce(failed);
  assert.equal(failed.steps[0].success, true); assert.equal(failed.steps[1].success, false);
  const detail = read("workflows", "instances", "step", "get", "coverage-owned-static-assets-20261015-1", "--workflow-name", workflow, "--name", "assets:upload-and-deploy-1", "--type", "step");
  assert.equal((detail.result ?? detail).error.message, "Static deployment allocation mismatch");
  const recovered = history("coverage-owned-static-assets-reconcile-20261015-1");
  assert.equal(recovered.status, "complete"); assert.equal(recovered.steps.length, 1); stepsOnce(recovered);
  assert.deepEqual(recovered.output, { revision: originalSource, manifestDigest, assetDigest, version: originalVersion, deployment: originalDeployment, target: "effect-ci-static-assets-demo", policy: "owned-static-assets-v1", externalWrites: 0 });
});

test("retained forbidden target payload failed before any native checkpoint", { skip: !enabled }, () => {
  const h = history("coverage-owned-static-assets-foreign-20261015-1");
  assert.equal(h.status, "errored"); assert.deepEqual(h.steps, []);
  assert.match(h.error.message, /Exact fixed-target static publication parameters required/);
});

test("current allocation, identity, raw served files and HTTP fences match the checked source", { skip: !current }, async () => {
  const allocation = read("workers", "deployments", "list", "--worker", "effect-ci-static-assets-demo", "--per-page", "1");
  assert.equal(allocation.deployments[0].id, deployment);
  assert.deepEqual(allocation.deployments[0].versions, [{ version_id: version, percentage: 100 }]);
  for (const [name, expected] of Object.entries(files)) {
    const response = await fetch(`${origin}/${name}`, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200); assert.equal(response.redirected, false);
    assert.equal(response.headers.get("content-security-policy"), staticAssetsCsp);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(bytes.length, expected.bytes); assert.equal(createHash("sha256").update(bytes).digest("hex"), expected.sha256);
  }
  const response = await fetch(`${origin}/__proof`, { redirect: "manual", signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { revision: source, manifestDigest, assetDigest });
  for (const [path, method, status] of [["/", "HEAD", 200], ["/", "POST", 405], ["/not-enrolled", "GET", 404]] as const) {
    const r = await fetch(origin + path, { method, redirect: "manual", signal: AbortSignal.timeout(10000) });
    assert.equal(r.status, status); await r.body?.cancel();
  }
});
