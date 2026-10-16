import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { staticAssetsCsp } from "@effect-ci-testbed/cloudflare/static-assets-publish";

const enabled = process.env.LIVE_OWNED_STATIC_BUILD === "1";
const current = enabled && process.env.LIVE_OWNED_STATIC_BUILD_CURRENT === "1";
const source = "36d7a3bf7df3c8664cdcec5450070ce509c4ebf1";
const workflow = "effect-ci-static-assets-publish";
const workflowVersion = "607cdbff-a20f-4425-ad84-eec288940f9c";
const brokerVersion = "3ac809f6-8d4c-436f-8016-59201711f084";
const version = "70ca9660-8a05-44da-b515-8e20d1a44f7f", deployment = "ee5b10c6-63fe-4001-99a2-18356db16aae";
const manifestDigest = "ca610e133ec247677b59b74a371dc70fb70cf6cce2c2cc94b7be306b16ac03bf";
const assetDigest = "89356d27e8feffe608588a7b98e46740d36f573ea45e765dfa7bc8126bcebfcb";
const build = { version: 1, tool: "sucrase-3.35.1-typescript",
  sourceManifestDigest: "dbad8ec1d92d79c30ca7e6a1209b2ab8e7126ec96fd67dce4f0d82b92788ccbd",
  sourceDigest: "e6c737677b3a1bef2bff9afb92c6f0a1c578c29724f89bc73da7eb1a75487fb5",
  outputDigest: "a1f54f745e0acd8b10ca02c49a8e6d6aeb6c4b5596533f1def23411489e740d4",
  toolDigest: "2da12cf0e34f0a6ae3179dff66b660490e9c9cc2a8a1417179d0d4aa588cbbc6",
  outputManifestDigest: manifestDigest };
const files = {
  "app.js": { bytes: 317, sha256: build.outputDigest },
  "index.html": { bytes: 1136, sha256: "2ed3bba4235c8b339225a90030869dc7d80194e55acf2f0c9cb3f701ebadf4cd" },
  "style.css": { bytes: 1558, sha256: "5783fa446229729d3b7db8cb77aa1deb52bffb7da54560205fdc1fd4cea71a7e" },
};
// GET-only retained histories, metadata and public bytes. No secret-file reads,
// GitHub token minting, instance creation, upload, deployment or retry.
const read = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args, {
  encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
}));
const history = (id: string) => read("workflows", "instances", "get", id, "--workflow-name", workflow);
const once = (h: any) => {
  for (const step of h.steps.filter((s: any) => s.type === "step")) {
    assert.equal(step.success, true); assert.equal(step.attempts.length, 1);
    assert.equal(step.config.retries.limit, 0); assert.equal(step.config.timeout, "2 minutes");
  }
};

test("retained actual hosted compiler passes fixed source/resource/capability checks without publication", { skip: !enabled }, () => {
  const h = history("coverage-owned-static-build-checks-20261016-1");
  assert.equal(h.status, "complete"); assert.equal(h.versionId, workflowVersion); once(h);
  assert.equal(h.output.claimedRevision, source); assert.equal(h.output.toolDigest, build.toolDigest);
  assert.deepEqual(h.output.checks, { typeScriptErased: true, malformedSourceRejected: true, oversizeSourceRejected: true,
    emptyChildBindings: true, networkDenied: true, parentBundleFileDenied: true, nativeProcessDenied: true, freshState: true });
  assert.deepEqual(h.output.parentBundle, { path: "/bundle/index.js", bytes: 1017169,
    sha256: "750bf1b989ff28ec0e9bea0b60052a76508dc7059f5cc5d4e25228fc85980dc4" });
  assert.equal(h.output.cpuEnforcementMeasured, false); assert.equal(h.output.externalWrites, 0); assert.equal(h.output.containers, 0);
  const broker = read("workers", "versions", "get", brokerVersion, "--worker-id", "effect-ci-static-assets-broker");
  assert.match(broker.annotations["workers/message"], new RegExp(source));
  assert.deepEqual(broker.urls, []); assert.deepEqual(broker.containers ?? [], []);
  assert.deepEqual(broker.bindings.filter((b: any) => b.name === "LOADER"), [{ name: "LOADER", type: "worker_loader" }]);
});

test("retained authenticated build captures raw source before compilation and verifies the emitted site", { skip: !enabled }, () => {
  const h = history("coverage-owned-static-build-20261016-1");
  assert.equal(h.status, "complete"); assert.equal(h.versionId, workflowVersion); once(h);
  assert.deepEqual(h.steps.map((s: any) => s.name), ["source:capture-build-input-1", "source:build-bounded-1",
    "assets:upload-and-deploy-1", "assets:fixed-convergence-1", "assets:verify-served-bytes-1"]);
  assert.equal(h.output.containers, 0); assert.equal(h.output.plan.nodes.length, 3);
  assert.ok(h.output.plan.nodes.every((n: any) => n.status === "complete" && n.commands.length === 0));
  assert.deepEqual(h.output.receipt, { revision: source, manifestDigest, assetDigest, version, deployment,
    target: "effect-ci-static-assets-demo", policy: "owned-static-assets-v1", build });
  const target = read("workers", "versions", "get", version, "--worker-id", "effect-ci-static-assets-demo");
  assert.equal(target.annotations["workers/commit_sha"], source); assert.deepEqual(target.bindings, [{ name: "ASSETS", type: "assets" }]);
});

test("current built site allocation, raw bytes, identity and HTTP fences match the native receipt", { skip: !current }, async () => {
  const allocation = read("workers", "deployments", "list", "--worker", "effect-ci-static-assets-demo", "--per-page", "1");
  assert.equal(allocation.deployments[0].id, deployment);
  assert.deepEqual(allocation.deployments[0].versions, [{ version_id: version, percentage: 100 }]);
  const origin = "https://effect-ci-static-assets-demo.ericclemmons.workers.dev";
  for (const [name, expected] of Object.entries(files)) {
    const r = await fetch(`${origin}/${name}`, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    assert.equal(r.status, 200); assert.equal(r.headers.get("content-security-policy"), staticAssetsCsp);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff"); const bytes = new Uint8Array(await r.arrayBuffer());
    assert.equal(bytes.length, expected.bytes); assert.equal(createHash("sha256").update(bytes).digest("hex"), expected.sha256);
  }
  const proof = await fetch(origin + "/__proof", { redirect: "manual", signal: AbortSignal.timeout(10000) });
  assert.equal(proof.status, 200); assert.deepEqual(await proof.json(), { revision: source, manifestDigest, assetDigest });
  for (const [path, method, status] of [["/", "HEAD", 200], ["/", "POST", 405], ["/not-enrolled", "GET", 404]] as const) {
    const r = await fetch(origin + path, { method, redirect: "manual", signal: AbortSignal.timeout(10000) });
    assert.equal(r.status, status); await r.body?.cancel();
  }
});
