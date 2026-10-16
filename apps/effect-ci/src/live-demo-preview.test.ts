import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

const enabled = process.env.LIVE_DEMO_PREVIEW === "1";
const id = "3b9098e0-c8f9-11f1-9c69-5d488bf82d84";
const revision = "e7179eccf60c82d6f0cbf57c5d7a880cc4bab108";
const version = "7aa076d2-23c6-4550-b197-d7754d4ae7df";
const digest = "cbb7c3279acf7de80096837e389e7ad8cbcbb92fdafb76b9c9251407bda7419b";
const origin = "https://effect-ci-hmd-demo.ericclemmons.workers.dev/";
const url = `https://effect-ci-demo-site.ericclemmons.workers.dev/r/${revision}/${digest}/index.html`;
// GET retained history/metadata and public files only. No dispatch, token mint,
// approval, upload, promotion or credential-file read is available here.
const cf = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args,
  { encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));

test("retained clearer preview releases through one compact card, fifteen replies and four delegated test decisions", { skip: !enabled }, () => {
  const h = cf("workflows", "instances", "get", id, "--workflow-name", "effect-ci-demo");
  assert.equal(h.status, "complete"); assert.equal(h.params.revision, revision);
  assert.equal(h.params.trigger, "github"); assert.equal(h.params.ref, "refs/heads/demo/live");
  assert.equal(h.output.nodes.length, 11); assert.ok(h.output.nodes.every((n: any) => n.status === "complete"));
  const compact = (name: string) => {
    const s = h.steps.find((s: any) => s.name === name + "-1");
    assert.ok(s); assert.equal(s.success, true); assert.equal(s.attempts.length, 1);
    if (s.output === null) return null; // Capability-close checkpoints intentionally return void.
    assert.ok(s.output.length < 1024 && !s.output.includes("[truncated output]")); return JSON.parse(s.output);
  };
  const notices = h.steps.filter((s: any) => s.name.startsWith("notification:") &&
    !s.name.startsWith("notification:hmd-image") && !s.name.includes(":thread-"));
  assert.equal(notices.length, 43);
  for (const s of notices) { const r = JSON.parse(s.output); assert.equal(r.failed, 0); assert.equal(r.slackMessageTs, "1792110824.305079"); }
  const posts = h.steps.filter((s: any) => s.name.endsWith(":thread-post-1"));
  assert.equal(posts.length, 15);
  assert.equal(new Set(posts.map((s: any) => JSON.parse(s.output).slackMessageTs)).size, 15);
  for (const s of posts) { assert.equal(s.config.retries.limit, 0); assert.equal(s.attempts.length, 1); assert.equal(JSON.parse(s.output).failed, 0); }
  for (const phase of [10, 25, 75, 100]) {
    const d = compact(`demo-review:decision-${phase}`);
    assert.equal(d.decision, "approved"); assert.match(d.actor, /^slack:/);
    compact(`vite-release:accept-${phase}`); compact(`demo-review:close-${phase}`);
  }
  assert.equal(h.steps.filter((s: any) => s.name.startsWith("notification:hmd-image")).length, 4);
  const commit = compact("vite-release:commit"); assert.equal(commit.status, "complete"); assert.equal(commit.candidate, version);
  assert.deepEqual(commit.deployment.versions, [{ version, percentage: 100 }]);
  assert.ok(!h.steps.some((s: any) => /vite-release:rollback/.test(s.name)));
  const commands = h.steps.filter((s: any) => s.name.startsWith("command:"));
  assert.equal(commands.length, 9); assert.ok(commands.every((s: any) => s.success && s.attempts.length === 1));
});

test("current release identity and actual UI bytes match the checked clearer preview", { skip: !enabled || process.env.LIVE_DEMO_PREVIEW_CURRENT !== "1" }, async () => {
  const allocation = cf("workers", "deployments", "list", "--worker", "effect-ci-hmd-demo", "--per-page", "1");
  assert.equal(allocation.deployments[0].id, "19a606ed-2601-41d5-bd73-bac01d2bc2c5");
  assert.deepEqual(allocation.deployments[0].versions, [{ version_id: version, percentage: 100 }]);
  const r = await fetch(origin, { redirect: "manual", signal: AbortSignal.timeout(10000) });
  assert.equal(r.status, 302); assert.equal(r.headers.get("location"), url); await r.body?.cancel();
  const health = await fetch(origin + "health", { redirect: "manual", signal: AbortSignal.timeout(10000) });
  assert.equal(health.status, 200); assert.deepEqual(await health.json(), { version, healthy: true, revision, digest });
  for (const [name, size, sha] of [
    ["index.html", 926, "cea4ffa2f433cf5d086041a821bbef2f90f6af39df2d9da3bae56f145a78d230"],
    ["app.js", 1660, "a5bb1bb19ab1d75f07725b5a7d50c2b1a38de5dd56b5adc6b1dadc6eee642b4f"],
    ["message.js", 100, "c9d95addba605e1fc6fff983591fbef245f4ae99d0f81356b9661bf7f3b343b0"],
  ] as const) {
    const response = await fetch(url.replace("index.html", name), { redirect: "manual", signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200); const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(bytes.length, size); assert.equal(createHash("sha256").update(bytes).digest("hex"), sha);
  }
});
