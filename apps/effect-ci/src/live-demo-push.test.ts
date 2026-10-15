import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

test("retained genuine demo push built, published and prepared with one maintained Slack card", { skip: !process.env.LIVE_DEMO_PUSH }, async () => {
  const read = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args, { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 }));
  // Read only: no dispatch, retry, approval, upload, publication or deployment.
  const id = "6bac9850-c89d-11f1-97b9-f8c7e1b07668";
  const revision = "198726b4de236d5eff6c74d0a099a28001b01b82";
  const history = read("workflows", "instances", "get", id, "--workflow-name", "effect-ci-demo");
  assert.equal(history.status, "complete");
  assert.equal(history.success, true);
  assert.equal(history.params.trigger, "github");
  assert.equal(history.params.deliveryId, id);
  assert.equal(history.params.ref, "refs/heads/demo/live");
  assert.equal(history.params.revision, revision);
  assert.equal(history.params.installationId, 165265172);
  assert.equal(history.output.nodes.length, 11);
  assert.ok(history.output.nodes.every((n: any) => n.status === "complete"));
  const commands = history.steps.filter((s: any) => s.name.startsWith("command:"));
  assert.equal(commands.length, 9);
  for (const step of commands) {
    assert.equal(step.success, true);
    assert.equal(step.attempts.length, 1);
    assert.equal(step.config.retries.limit, 0);
  }
  const notifications = history.steps.filter((s: any) => s.name.startsWith("notification:"));
  assert.equal(notifications.length, 35);
  for (const step of notifications) {
    assert.equal(step.success, true);
    assert.equal(step.attempts.length, 1);
    assert.deepEqual(JSON.parse(step.output), { delivered: 1, failed: 0, slackMessageTs: "1792071393.501679" });
  }
  const value = (name: string) => {
    const step = history.steps.find((s: any) => s.name === `action:"${name}"-1`);
    assert.equal(step.success, true);
    assert.equal(step.attempts.length, 1);
    assert.equal(step.config.retries.limit, 0);
    return JSON.parse(step.output).value.data;
  };
  const publication = value("publish site"), candidate = value("prepare release");
  assert.equal(publication.revision, revision);
  assert.equal(candidate.revision, revision);
  assert.equal(candidate.digest, publication.digest);
  assert.equal(candidate.version, "658a71c7-4dab-4bc1-82a6-503cb20b44e8");
  assert.equal(candidate.moduleDigest, "a1b50a08e5f9fe5478eb61b4be0cc6a48772826fc2ef5d616fb42e8e3eed73a6");
  const checked = JSON.parse(JSON.parse(commands.find((s: any) => s.name === 'command:["verify build",1]-1').output).stdout.trim());
  assert.equal(checked.verified, true);
  assert.equal(checked.files.length, 3);
  for (const file of checked.files) {
    const response = await fetch(publication.url.replace("index.html", file.path.slice(5)), { redirect: "manual", signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(bytes.length, file.size);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  }
  const version = read("workers", "versions", "get", candidate.version, "--worker-id", "effect-ci-hmd-demo");
  assert.equal(version.annotations["workers/commit_sha"], revision);
  assert.equal(version.annotations["workers/message"], `effect-ci-vite:${candidate.digest}:${candidate.moduleDigest}`);
  assert.deepEqual(version.bindings, [{ name: "FAILURE_RATE", text: "0", type: "plain_text" }, { name: "WORKER_METADATA", type: "version_metadata" }]);
  const health = await fetch("https://658a71c7-effect-ci-hmd-demo.ericclemmons.workers.dev/health", { redirect: "manual" });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { version: candidate.version, healthy: true, revision, digest: candidate.digest });
});
