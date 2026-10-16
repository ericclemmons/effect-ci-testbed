import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

const enabled = process.env.LIVE_POLISHED_RELEASE === "1";
const id = "09197290-c92d-11f1-9009-78a9ef81cc07", revision = "f240bd06a71fbec1b14a5e1e89b69048cbdeda9e";
const version = "c16d7b0b-06ee-4e51-9344-cedab110a5b7", digest = "8165a25e1670ed567b43c11eee03c622743c9d834d19f639bd3ae99a0cd724cf";
const url = `https://effect-ci-demo-site.ericclemmons.workers.dev/r/${revision}/${digest}/index.html`;
const read = (bin: string, ...args: string[]) => JSON.parse(execFileSync(bin, args,
  { encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
const cf = (...args: string[]) => read(process.env.CF_BIN ?? "cf", ...args);

// GET-only retained acceptance; never dispatch, approve, publish or redeploy.
test("normal main releases the CSP-compatible Kumo build, with live phase status and retained charts", { skip: !enabled }, async () => {
  const h = cf("workflows", "instances", "get", id, "--workflow-name", "effect-ci-demo");
  assert.equal(h.status, "complete"); assert.equal(h.success, true);
  assert.equal(h.params.revision, revision); assert.equal(h.params.ref, "refs/heads/main");
  assert.equal(h.params.trigger, "github"); assert.equal(h.params.deliveryId, id);
  const step = (name: string) => { const s = h.steps.find((s: any) => s.name === name + "-1");
    assert.ok(s); assert.equal(s.success, true); assert.equal(s.attempts.length, 1); return s; };
  const compact = (name: string) => { const s = step(name); assert.ok(!s.output.includes("[truncated output]")); return JSON.parse(s.output); };
  const full = (name: string) => { step(name); const envelope = cf("workflows", "instances", "step", "get", id,
    "--workflow-name", "effect-ci-demo", "--name", name + "-1", "--type", "step");
    const r = envelope.result ?? envelope; assert.equal(r.status, "complete"); assert.equal(r.error, null);
    return typeof r.output === "string" ? JSON.parse(r.output) : r.output; };
  const images = new Set();
  for (const [phase, trials] of [[10, 11], [25, 18], [75, 73], [100, 100]]) {
    const o = full(`vite-release:observe-${phase}`), d = compact(`demo-review:decision-${phase}`);
    assert.equal(o.owner, id); assert.equal(o.phase, phase); assert.equal(o.candidate.version, version);
    assert.equal(o.candidate.trials, trials); assert.equal(o.candidate.failures, 0); assert.equal(o.baseline.failures, 0);
    assert.equal(o.decision.status, "uncertain"); assert.equal(d.snapshot, o.snapshot); assert.equal(d.decision, "approved");
    assert.match(d.actor, /^slack:/); assert.ok(d.acceptedAt >= o.candidate.to && d.acceptedAt < o.expiresAt);
    assert.equal(compact(`vite-release:accept-${phase}`).basis, "human-risk-acceptance");
    const promoted = h.steps.indexOf(step(`vite-release:promote-${phase}`));
    const notice = step(`notification:host-observe:settling-${phase}`);
    assert.equal(JSON.parse(notice.output).slackMessageTs, "1792133073.110299");
    const settling = h.steps.find((s: any) => s.name === `vite-release:settle-${phase}-1`);
    assert.ok(promoted < h.steps.indexOf(notice) && h.steps.indexOf(notice) < h.steps.indexOf(settling));
    assert.equal(Date.parse(settling.end) - Date.parse(settling.start), 120000);
    const image = compact(`notification:hmd-image-${phase}`); assert.equal(image.ok, true); images.add(image.fileId);
  }
  assert.equal(images.size, 4); assert.equal(h.steps.filter((s: any) => s.name.endsWith(":thread-post-1")).length, 15);
  const commit = compact("vite-release:commit"); assert.equal(commit.status, "complete");
  assert.equal(commit.deployment.id, "7e6f7275-86d2-4cd5-a245-ded56aa96aef");
  assert.deepEqual(commit.deployment.versions, [{ version, percentage: 100 }]);
  assert.deepEqual(commit.previous, [{ version: "24e0ff19-3c7a-4673-b300-cb2bf5374a29", percentage: 100 }]);
  assert.ok(!h.steps.some((s: any) => /vite-release:(restore|rollback)/.test(s.name)));
  assert.equal(h.output.nodes.length, 11); assert.ok(h.output.nodes.every((n: any) => n.status === "complete"));
  const commands = h.steps.filter((s: any) => s.name.startsWith("command:")); assert.equal(commands.length, 9);
  assert.ok(commands.every((s: any) => s.success && s.attempts.length === 1 && s.config.retries.limit === 0));
  const pages = read("gh", "api", "--paginate", "--slurp", `repos/ericclemmons/effect-ci-testbed/commits/${revision}/check-runs?per_page=100`);
  const checks = pages.flatMap((p: any) => p.check_runs).filter((c: any) => c.app.id === 5089816 && c.details_url?.endsWith(`/instance/${id}`));
  assert.equal(checks.length, 12); assert.ok(checks.every((c: any) => c.conclusion === "success"));
  const files = JSON.parse(compact('command:["verify build",1]').stdout.trim()).files;
  assert.deepEqual(files.map((f: any) => f.path), ["dist/index.html", "dist/app.js", "dist/message.js"]);
  for (const f of files) {
    const r = await fetch(url.replace("index.html", f.path.slice(5)), { redirect: "manual", signal: AbortSignal.timeout(15000) });
    assert.equal(r.status, 200); const bytes = new Uint8Array(await r.arrayBuffer());
    assert.equal(bytes.length, f.size); assert.equal(createHash("sha256").update(bytes).digest("hex"), f.sha256);
    if (f.path === "dist/index.html") {
      const html = new TextDecoder().decode(bytes), csp = r.headers.get("content-security-policy")!;
      assert.ok(!/<button\b[^>]*\sstyle=/i.test(html));
      assert.ok(!/unsafe-inline|unsafe-hashes|unsafe-eval/.test(csp));
      const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style\s*>/gi)]; assert.equal(styles.length, 2);
      for (const style of styles) assert.ok(csp.includes(`'sha256-${createHash("sha256").update(style[1]!).digest("base64")}'`));
    }
  }
});

test("current production redirect and health identity are the exact polished candidate", { skip: !enabled || process.env.LIVE_POLISHED_RELEASE_CURRENT !== "1" }, async () => {
  const d = cf("workers", "deployments", "list", "--worker", "effect-ci-hmd-demo", "--per-page", "1").deployments[0];
  assert.equal(d.id, "7e6f7275-86d2-4cd5-a245-ded56aa96aef"); assert.deepEqual(d.versions, [{ version_id: version, percentage: 100 }]);
  const r = await fetch("https://effect-ci-hmd-demo.ericclemmons.workers.dev/", { redirect: "manual", signal: AbortSignal.timeout(15000) });
  assert.equal(r.status, 302); assert.equal(r.headers.get("location"), url); await r.body?.cancel();
  const health = await fetch("https://effect-ci-hmd-demo.ericclemmons.workers.dev/health", { redirect: "manual", signal: AbortSignal.timeout(15000) });
  assert.equal(health.status, 200); assert.deepEqual(await health.json(), { version, healthy: true, revision, digest });
});
