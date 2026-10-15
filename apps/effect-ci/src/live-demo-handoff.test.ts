import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test(
  "retained native Vite build reaches its next action through automatic workspace revision",
  { skip: !process.env.LIVE_DEMO_HANDOFF },
  () => {
    // Read the existing completed history only; never dispatch, deploy or sign.
    const history = JSON.parse(
      execFileSync(
        process.env.CF_BIN ?? "cf",
        [
          "workflows",
          "instances",
          "get",
          "0f5761d7-f156-4a8c-bba7-d2452ac54523",
          "--workflow-name",
          "effect-ci-demo",
        ],
        { encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
      ),
    );
    assert.equal(history.status, "complete");
    assert.equal(history.success, true);
    assert.equal(history.params.revision, "5798f262c54cba2a66fd95ef8c8f4f5a2cfb0d2f");
    assert.equal(
      history.params.repository,
      "https://github.com/ericclemmons/effect-ci-testbed.git",
    );
    assert.equal(history.output.environment, "cloudflare");
    assert.deepEqual(
      history.output.nodes.map((node: any) => [node.id, node.status]),
      [
        "checkout",
        "install",
        "syntax",
        "lint",
        "check",
        "typecheck",
        "test",
        "build",
        "verify build",
      ].map((id) => [id, "complete"]),
    );
    const commands = history.steps.filter((step: any) => step.name.startsWith("command:"));
    assert.equal(commands.length, 9);
    for (const name of ["install", "lint", "check", "typecheck", "test", "build", "verify build"]) {
      const command = commands.find((step: any) => step.name === `command:["${name}",1]-1`);
      assert.ok(command, `ordinary ${name} must execute`);
      // Large previews are truncated by the history API; bounded verifier JSON is parsed below.
      assert.match(command.output, /^\{"exitCode":0,/);
    }
    const verifier = commands.find((step: any) => step.name === 'command:["verify build",1]-1');
    const verified = JSON.parse(JSON.parse(verifier.output).stdout.trim());
    assert.deepEqual(verified, {
      verified: true,
      files: [
        {
          path: "dist/index.html",
          size: 523,
          sha256: "55e9686c30048c16159e3fdb3630ed9abea09c744b1f8094398557b6d9d1300b",
        },
        {
          path: "dist/app.js",
          size: 1520,
          sha256: "636c0c46e56a8f6bccd8123a130f79699155e73ae3a034246a144805b015516c",
        },
        {
          path: "dist/message.js",
          size: 103,
          sha256: "0355881db4410874785524c515e8847aa02c06640428642578118c42e64d2b78",
        },
      ],
    });
    assert.ok(!history.steps.some((step: any) => /checkpoint-artifact|:restore-/.test(step.name)));
    for (const name of ["build:commit-1", "verify build:commit-1"]) {
      const commit = history.steps.find((step: any) => step.name === name);
      assert.ok(commit?.success);
      assert.match(JSON.parse(commit.output).id, /^[a-f0-9-]{36}$/);
      assert.equal(commit.attempts.length, 1);
    }
    for (const command of commands) {
      assert.equal(command.success, true);
      assert.equal(command.attempts.length, 1);
      assert.equal(command.config.retries.limit, 0);
    }
  },
);
