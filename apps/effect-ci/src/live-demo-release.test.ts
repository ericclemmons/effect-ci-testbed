import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

test("retained push releases the same checked candidate through four delegated test decisions and commits 100%", { skip: !process.env.LIVE_DEMO_RELEASE }, async () => {
  const read = (bin: string, ...args: string[]) => JSON.parse(execFileSync(bin, args, { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 }));
  const cf = (...args: string[]) => read(process.env.CF_BIN ?? "cf", ...args);
  const id = "5531ae60-c8ae-11f1-9c16-9654df11c69b", revision = "867c7db95770f8f74a1d7124a2717998176a6c49", ts = "1792078658.255589";
  // Historical GETs and public HTTP GETs only. No dispatch, approval, upload or deployment.
  const h = cf("workflows", "instances", "get", id, "--workflow-name", "effect-ci-demo");
  assert.equal(h.status, "complete"); assert.equal(h.success, true);
  assert.equal(h.params.trigger, "github"); assert.equal(h.params.deliveryId, id);
  assert.equal(h.params.ref, "refs/heads/demo/live"); assert.equal(h.params.revision, revision);
  assert.equal(h.params.installationId, 165265172);
  const step = (name: string) => { const s = h.steps.find((s: any) => s.name === `${name}-1`); assert.ok(s); assert.equal(s.success, true); assert.equal(s.attempts.length, 1); return s; };
  const compact = (name: string) => { const s = step(name); assert.ok(s.output.length < 1024 && !s.output.includes("[truncated output]")); return JSON.parse(s.output); };
  const full = (name: string) => { const response = cf("workflows", "instances", "step", "get", id, "--workflow-name", "effect-ci-demo", "--name", `${name}-1`, "--type", "step"); const r = response.result ?? response; assert.equal(r.status, "complete"); assert.equal(r.error, null); return r.output; };
  const candidate = compact('action:"prepare release"').value.data, publication = compact('action:"publish site"').value.data;
  assert.equal(candidate.revision, revision); assert.equal(candidate.version, "ef0d65a2-e720-4fa1-8806-93bb3bb4d585");
  assert.equal(candidate.digest, "e9fad7f0e6117c0a33f76d9d9891ebefb2c34519364179e464857a2780efcb23");
  assert.equal(candidate.moduleDigest, "3ef8f92aeb20947ab16ad1900cd495ea2bc73319c16c58513e7bb8b113f23825");
  assert.equal(publication.revision, revision); assert.equal(publication.digest, candidate.digest);
  assert.equal(publication.url, `https://effect-ci-demo-site.ericclemmons.workers.dev/r/${revision}/${candidate.digest}/index.html`);
  const actors = new Set(), files = new Set();
  for (const [phase, trials] of [[10, 7], [25, 27], [75, 82], [100, 100]]) {
    const observation = full(`vite-release:observe-${phase}`), decision = compact(`demo-review:decision-${phase}`);
    assert.equal(observation.owner, id); assert.equal(observation.phase, phase);
    assert.equal(observation.candidate.version, candidate.version); assert.equal(observation.candidate.trials, trials); assert.equal(observation.candidate.failures, 0);
    assert.equal(observation.baseline.trials, 100); assert.equal(observation.decision.status, "uncertain", "risk acceptance is not a conclusive health pass");
    assert.equal(decision.snapshot, observation.snapshot); assert.equal(decision.decision, "approved");
    assert.ok(decision.actor?.startsWith("slack:")); actors.add(decision.actor);
    assert.ok(decision.acceptedAt >= observation.candidate.to && decision.acceptedAt < observation.expiresAt);
    assert.equal(compact(`vite-release:accept-${phase}`).basis, "human-risk-acceptance");
    assert.equal(step(`demo-review:decision-${phase}`).config.retries.limit, 0);
    const image = compact(`notification:hmd-image-${phase}`); assert.equal(image.ok, true); files.add(image.fileId);
    const sleep = h.steps.find((s: any) => s.name === `vite-release:settle-${phase}-1`); assert.equal(sleep.type, "sleep"); assert.equal(sleep.finished, true); assert.equal(Date.parse(sleep.end) - Date.parse(sleep.start), 120000);
  }
  assert.equal(actors.size, 1); assert.equal(files.size, 4);
  const last = full("vite-release:probe-100"); assert.equal(last.requested, 100); assert.equal(last.unknown, 0); assert.equal(last.outcomes.length, 100); assert.ok(last.outcomes.every((o: any) => o.version === candidate.version && o.healthy === true));
  const commit = compact("vite-release:commit"); assert.equal(commit.status, "complete"); assert.equal(commit.candidate, candidate.version);
  assert.equal(commit.deployment.id, "0cb01356-6942-458d-a7cb-8b93ec67832a"); assert.deepEqual(commit.deployment.versions, [{ version: candidate.version, percentage: 100 }]);
  assert.deepEqual(commit.previous, [{ version: "09593237-23b2-4873-bd04-88c8e8488840", percentage: 100 }]);
  assert.ok(!h.steps.some((s: any) => s.name.startsWith("vite-release:restore")));
  const notices = h.steps.filter((s: any) => s.name.startsWith("notification:") && !s.name.startsWith("notification:hmd-image")); assert.equal(notices.length, 43);
  let validations = 0; for (const s of notices) { const r = JSON.parse(s.output); assert.equal(s.success, true); assert.equal(s.attempts.length, 1); assert.equal(r.delivered, 1); assert.equal(r.failed, 0); assert.equal(r.slackMessageTs, ts); validations += r.slackImageValidationRetries ?? 0; }
  assert.equal(validations, 5, "five definite image-validation rejections, not ambiguous updates or Workflow retries");
  const commands = h.steps.filter((s: any) => s.name.startsWith("command:")); assert.equal(commands.length, 9); for (const s of commands) { assert.equal(s.success, true); assert.equal(s.attempts.length, 1); assert.equal(s.config.retries.limit, 0); }
  assert.equal(h.output.nodes.length, 11); assert.ok(h.output.nodes.every((n: any) => n.status === "complete"));
  const checks = read("gh", "api", `repos/ericclemmons/effect-ci-testbed/commits/${revision}/check-runs`).check_runs.filter((c: any) => c.app.id === 5089816); assert.equal(checks.length, 12); assert.ok(checks.every((c: any) => c.conclusion === "success"));
  const version = cf("workers", "versions", "get", candidate.version, "--worker-id", "effect-ci-hmd-demo"); assert.equal(version.annotations["workers/commit_sha"], revision); assert.equal(version.annotations["workers/message"], `effect-ci-vite:${candidate.digest}:${candidate.moduleDigest}`);
  assert.deepEqual(version.bindings, [{ name: "FAILURE_RATE", text: "0", type: "plain_text" }, { name: "WORKER_METADATA", type: "version_metadata" }]);
  const verifier = JSON.parse(compact('command:["verify build",1]').stdout.trim()); assert.deepEqual(verifier.files.map((f: any) => f.path), ["dist/index.html", "dist/app.js", "dist/message.js"]);
  for (const f of verifier.files) { const r = await fetch(publication.url.replace("index.html", f.path.slice(5)), { redirect: "manual", signal: AbortSignal.timeout(15000) }); assert.equal(r.status, 200); const bytes = new Uint8Array(await r.arrayBuffer()); assert.equal(bytes.length, f.size); assert.equal(createHash("sha256").update(bytes).digest("hex"), f.sha256); }
  const missing = await fetch(publication.url.replace(candidate.digest, "0".repeat(64)), { redirect: "manual", signal: AbortSignal.timeout(15000) }); assert.equal(missing.status, 404); await missing.body?.cancel();
  if (process.env.LIVE_DEMO_RELEASE_CURRENT) {
    // Optional current-allocation assertion: intentionally separate from immutable
    // historical proof so a later legitimate release does not invalidate history.
    const allocation = cf("workers", "deployments", "list", "--worker", "effect-ci-hmd-demo", "--per-page", "1"); assert.equal(allocation.deployments[0].id, commit.deployment.id); assert.deepEqual(allocation.deployments[0].versions, [{ version_id: candidate.version, percentage: 100 }]);
    const root = await fetch("https://effect-ci-hmd-demo.ericclemmons.workers.dev/", { redirect: "manual", signal: AbortSignal.timeout(15000) }); assert.equal(root.status, 302); assert.equal(root.headers.get("location"), publication.url); await root.body?.cancel();
    const health = await fetch("https://effect-ci-hmd-demo.ericclemmons.workers.dev/health", { redirect: "manual", signal: AbortSignal.timeout(15000) }); assert.equal(health.status, 200); assert.deepEqual(await health.json(), { version: candidate.version, healthy: true, revision, digest: candidate.digest });
  }
});
