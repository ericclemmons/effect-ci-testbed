import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test(
  "retained native recovery completes the original candidate without rewriting the failed build",
  { skip: !process.env.LIVE_DEMO_CANDIDATE_RECOVERY },
  async () => {
    const read = (...args: string[]) =>
      JSON.parse(
        execFileSync(process.env.CF_BIN ?? "cf", args, {
          encoding: "utf8",
          timeout: 60000,
          maxBuffer: 8 * 1024 * 1024,
        }),
      );
    // Existing histories and public health only. Never create, retry, deploy or sign.
    const original = read(
      "workflows",
      "instances",
      "get",
      "d6ac9135-68be-41a8-8e04-42a50049b4ad",
      "--workflow-name",
      "effect-ci-demo",
    );
    assert.equal(original.status, "errored");
    assert.equal(original.params.revision, "f4860ce5532c3d724db41bed511a787c114971e8");
    assert.equal(
      original.steps.find((s: any) => s.name === 'action:"prepare release"-1').success,
      false,
    );
    const recovered = read(
      "workflows",
      "instances",
      "get",
      "coverage-demo-candidate-reconcile-20261015-1",
      "--workflow-name",
      "effect-ci-demo-candidate-recovery",
    );
    assert.equal(recovered.status, "complete");
    assert.equal(recovered.success, true);
    assert.deepEqual(recovered.params, { mode: "reconcile-original" });
    assert.equal(recovered.steps.length, 1);
    const step = recovered.steps[0];
    assert.equal(step.name, "candidate:reconcile-original-1");
    assert.equal(step.success, true);
    assert.equal(step.attempts.length, 1);
    assert.equal(step.config.retries.limit, 0);
    assert.deepEqual(JSON.parse(step.output), recovered.output);
    const expected = {
      revision: "f4860ce5532c3d724db41bed511a787c114971e8",
      digest: "e9fad7f0e6117c0a33f76d9d9891ebefb2c34519364179e464857a2780efcb23",
      version: "d91c0765-1994-4aad-8aad-f359374c2f45",
      moduleDigest: "b31fdf4ab424fa3a284205bbbee1b735e6b1151c3785628f0064669e1f8aabd7",
      policy: "owned-vite-release-pointer-v1",
      script: "effect-ci-hmd-demo",
      uploadPerformed: false,
      deploymentPerformed: false,
    };
    assert.deepEqual(recovered.output, expected);
    const version = read(
      "workers",
      "versions",
      "get",
      expected.version,
      "--worker-id",
      expected.script,
    );
    assert.equal(version.annotations["workers/commit_sha"], expected.revision);
    assert.equal(
      version.annotations["workers/message"],
      `effect-ci-vite:${expected.digest}:${expected.moduleDigest}`,
    );
    assert.deepEqual(version.bindings, [
      { name: "FAILURE_RATE", text: "0", type: "plain_text" },
      { name: "WORKER_METADATA", type: "version_metadata" },
    ]);
    const response = await fetch(
      "https://d91c0765-effect-ci-hmd-demo.ericclemmons.workers.dev/health",
      { redirect: "manual" },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      version: expected.version,
      healthy: true,
      revision: expected.revision,
      digest: expected.digest,
    });
  },
);
