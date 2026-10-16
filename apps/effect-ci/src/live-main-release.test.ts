import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

const enabled = process.env.LIVE_MAIN_RELEASE === "1";
const id = "1402d960-c925-11f1-8d1a-09e28c4c90fb";
const revision = "535ef4153612b6e850f6ab57e50b50e260f523cf";
const version = "24e0ff19-3c7a-4673-b300-cb2bf5374a29";
const digest = "778ba85c251d86abc1f634072bdd4cb537a59cbe7772f53f2e4dbf05e688b7c3";
const url = `https://effect-ci-demo-site.ericclemmons.workers.dev/r/${revision}/${digest}/index.html`;
const read = (bin: string, ...args: string[]) => JSON.parse(execFileSync(bin, args,
  { encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
const cf = (...args: string[]) => read(process.env.CF_BIN ?? "cf", ...args);

// Explicitly opt-in, GET-only acceptance. Never dispatch/replay a completed release.
test("normal main merge retains one card and commits the checked Kumo app after four delegated test decisions", { skip: !enabled }, async () => {
  const h = cf("workflows", "instances", "get", id, "--workflow-name", "effect-ci-demo");
  assert.equal(h.status, "complete"); assert.equal(h.success, true);
  assert.equal(h.params.trigger, "github"); assert.equal(h.params.deliveryId, id);
  assert.equal(h.params.ref, "refs/heads/main"); assert.equal(h.params.revision, revision);
  const step = (name: string) => {
    const s = h.steps.find((s: any) => s.name === name + "-1");
    assert.ok(s); assert.equal(s.success, true); assert.equal(s.attempts.length, 1); return s;
  };
  const compact = (name: string) => {
    const s = step(name); assert.ok(!s.output.includes("[truncated output]")); return JSON.parse(s.output);
  };
  const full = (name: string) => {
    step(name);
    const envelope = cf("workflows", "instances", "step", "get", id, "--workflow-name", "effect-ci-demo", "--name", name + "-1", "--type", "step");
    const r = envelope.result ?? envelope; assert.equal(r.status, "complete"); assert.equal(r.error, null);
    return typeof r.output === "string" ? JSON.parse(r.output) : r.output;
  };
  const candidate = compact('action:"prepare release"').value.data;
  assert.equal(candidate.version, version); assert.equal(candidate.revision, revision); assert.equal(candidate.digest, digest);
  assert.equal(compact('action:"publish site"').value.data.url, url);
  const images = new Set();
  for (const [phase, trials] of [[10, 12], [25, 21], [75, 74], [100, 100]]) {
    const o = full(`vite-release:observe-${phase}`), d = compact(`demo-review:decision-${phase}`);
    assert.equal(o.owner, id); assert.equal(o.phase, phase); assert.equal(o.candidate.version, version);
    assert.equal(o.candidate.trials, trials); assert.equal(o.candidate.failures, 0);
    assert.equal(o.baseline.trials, 100); assert.equal(o.baseline.failures, 0);
    assert.equal(o.decision.status, "uncertain");
    assert.equal(d.snapshot, o.snapshot); assert.equal(d.decision, "approved"); assert.match(d.actor, /^slack:/);
    assert.ok(d.acceptedAt >= o.candidate.to && d.acceptedAt < o.expiresAt);
    assert.equal(compact(`vite-release:accept-${phase}`).basis, "human-risk-acceptance");
    assert.equal(step(`demo-review:decision-${phase}`).config.retries.limit, 0);
    const sleep = h.steps.find((s: any) => s.name === `vite-release:settle-${phase}-1`);
    assert.equal(sleep.finished, true); assert.equal(Date.parse(sleep.end) - Date.parse(sleep.start), 120000);
    const image = compact(`notification:hmd-image-${phase}`); assert.equal(image.ok, true); images.add(image.fileId);
  }
  assert.equal(images.size, 4);
  const commit = compact("vite-release:commit"); assert.equal(commit.status, "complete");
  assert.equal(commit.deployment.id, "48160a78-e72a-4b67-824e-45203c02d5fb");
  assert.deepEqual(commit.deployment.versions, [{ version, percentage: 100 }]);
  assert.deepEqual(commit.previous, [{ version: "7aa076d2-23c6-4550-b197-d7754d4ae7df", percentage: 100 }]);
  assert.ok(!h.steps.some((s: any) => s.name.startsWith("vite-release:restore")));
  assert.equal(h.output.nodes.length, 11); assert.ok(h.output.nodes.every((n: any) => n.status === "complete"));
  const commands = h.steps.filter((s: any) => s.name.startsWith("command:"));
  assert.equal(commands.length, 9); assert.ok(commands.every((s: any) => s.success && s.attempts.length === 1));
  const notices = h.steps.filter((s: any) => s.name.startsWith("notification:") && !s.name.startsWith("notification:hmd-image"));
  const posts = notices.filter((s: any) => s.name.endsWith(":thread-post-1")); assert.equal(posts.length, 15);
  for (const s of notices) {
    const r = JSON.parse(s.output); assert.equal(r.failed, 0); assert.equal(s.attempts.length, 1);
    if (!s.name.includes(":thread-")) assert.equal(r.slackMessageTs, "1792129654.377089");
  }
  const checkPages = read("gh", "api", "--paginate", "--slurp", `repos/ericclemmons/effect-ci-testbed/commits/${revision}/check-runs?per_page=100`);
  const checks = checkPages.flatMap((page: any) => page.check_runs).filter((c: any) => c.app.id === 5089816 && c.details_url?.endsWith(`/instance/${id}`));
  assert.equal(checks.length, 12); assert.ok(checks.every((c: any) => c.conclusion === "success"));
  const files = JSON.parse(compact('command:["verify build",1]').stdout.trim()).files;
  assert.deepEqual(files.map((f: any) => f.path), ["dist/index.html", "dist/app.js", "dist/message.js"]);
  for (const f of files) {
    const r = await fetch(url.replace("index.html", f.path.slice(5)), { redirect: "manual", signal: AbortSignal.timeout(15000) });
    assert.equal(r.status, 200); const b = new Uint8Array(await r.arrayBuffer());
    assert.equal(b.length, f.size); assert.equal(createHash("sha256").update(b).digest("hex"), f.sha256);
  }
});

test("current main release allocation and redirect remain the same verified candidate", { skip: !enabled || process.env.LIVE_MAIN_RELEASE_CURRENT !== "1" }, async () => {
  const deployment = cf("workers", "deployments", "list", "--worker", "effect-ci-hmd-demo", "--per-page", "1").deployments[0];
  assert.equal(deployment.id, "48160a78-e72a-4b67-824e-45203c02d5fb");
  assert.deepEqual(deployment.versions, [{ version_id: version, percentage: 100 }]);
  const r = await fetch("https://effect-ci-hmd-demo.ericclemmons.workers.dev/", { redirect: "manual", signal: AbortSignal.timeout(15000) });
  assert.equal(r.status, 302); assert.equal(r.headers.get("location"), url); await r.body?.cancel();
  const health = await fetch("https://effect-ci-hmd-demo.ericclemmons.workers.dev/health", { redirect: "manual", signal: AbortSignal.timeout(15000) });
  assert.equal(health.status, 200); assert.deepEqual(await health.json(), { version, healthy: true, revision, digest });
});
