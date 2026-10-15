import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test(
  "retained same-app native remote run completed its real package commands, without redispatch",
  {
    skip: !process.env.LIVE_DEMO_INSTANCE,
  },
  () => {
    const id = process.env.LIVE_DEMO_INSTANCE!;
    assert.equal(id, "f62fe0db-05e6-4acd-9492-9c8cbfacb6ac");
    const history = JSON.parse(
      execFileSync(
        process.env.CF_BIN ?? "cf",
        ["workflows", "instances", "get", id, "--workflow-name", "effect-ci-demo"],
        { encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
      ),
    );
    assert.equal(history.status, "complete");
    assert.equal(history.success, true);
    assert.equal(history.versionId, "e3c85657-71cd-4da3-9e7d-cb2b36955155");
    assert.deepEqual(history.params, {
      trigger: "remote",
      repository: "https://github.com/ericclemmons/effect-ci-testbed.git",
      revision: "2c8a27600b168655c2fd989e4abb200d60f3ffb8",
    });
    assert.equal(history.output.workflowId, "cf-ci-demo");
    assert.equal(history.output.environment, "cloudflare");
    assert.deepEqual(
      history.output.nodes.map((node: any) => node.id),
      ["checkout", "install", "lint", "check", "typecheck", "test", "build"],
    );
    assert.ok(history.output.nodes.every((node: any) => node.status === "complete"));
    const commands = history.steps.filter((step: any) => step.name.startsWith("command:"));
    assert.equal(commands.length, 6);
    for (const step of commands) {
      assert.equal(step.success, true);
      assert.equal(step.config.retries.limit, 0);
      assert.equal(step.attempts.length, 1);
      assert.equal(step.attempts[0].success, true);
      // The history API truncates large step previews. The original CLI stream
      // retains full command objects; do not parse a truncated preview as JSON.
      assert.match(step.output, /^\{"exitCode":0,/);
    }
    const build = JSON.parse(commands.at(-1).output);
    for (const name of ["dist/index.html", "dist/app.js", "dist/message.js"]) {
      assert.ok(build.stdout.includes(name));
    }
    if (process.env.LIVE_DEMO_RECEIPT) {
      const receipt = JSON.parse(readFileSync(process.env.LIVE_DEMO_RECEIPT, "utf8"));
      assert.equal(receipt.cli.ok, true);
      assert.equal(receipt.exit.code, 0);
      assert.deepEqual(receipt.intent.arguments, ["run", "--remote"]);
      assert.equal(receipt.cli.result.instanceId, id);
      assert.equal(receipt.intent.revision, history.params.revision);
      assert.equal(receipt.deployed.version.id, "57135e60-28d7-4700-bd42-4187bdb2820e");
      for (const step of commands) {
        const event = receipt.cli.result.events.find(
          (event: any) => event.type === "step_completed" && event.stepName === step.name,
        );
        assert.equal(event?.output.exitCode, 0);
      }
      const tests = receipt.cli.result.events.find(
        (event: any) =>
          event.type === "step_completed" && event.stepName === 'command:["test",1]-1',
      );
      assert.match(tests.output.stdout, /Tests\s+1 passed/);
      assert.match(tests.output.stdout, /pass 17/);
    }
  },
);
