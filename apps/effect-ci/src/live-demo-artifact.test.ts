import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const revision = "7a64ae82ac7b4a24496b58b36412968a0d4e1f72";
const cases = [
  {
    name: "unsigned build executes and restores its actual assets",
    id: "cd92c09c-9f8a-421b-8609-0195bea5889a",
    hit: false,
  },
  {
    name: "signed syntax reuse still executes build and artifact transfer",
    id: "3559464e-1234-4787-b093-8a1498b3232c",
    hit: true,
  },
] as const;

for (const entry of cases) {
  test(
    `retained native Vite artifact: ${entry.name}`,
    { skip: !process.env.LIVE_DEMO_ARTIFACT },
    () => {
      // Read an existing native history only. Never dispatch or mutate evidence.
      const history = JSON.parse(
        execFileSync(
          process.env.CF_BIN ?? "cf",
          ["workflows", "instances", "get", entry.id, "--workflow-name", "effect-ci-demo"],
          { encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
        ),
      );
      assert.equal(history.status, "complete");
      assert.equal(history.success, true);
      assert.equal(history.params.revision, revision);
      assert.equal(
        history.params.repository,
        "https://github.com/ericclemmons/effect-ci-testbed.git",
      );
      assert.equal(history.output.environment, "cloudflare");
      assert.equal(history.output.nodes.length, 10);
      for (const node of history.output.nodes) {
        assert.equal(node.status, node.id === "syntax" && entry.hit ? "verified" : "complete");
      }
      const commands = history.steps.filter((step: any) => step.name.startsWith("command:"));
      assert.equal(commands.length, entry.hit ? 9 : 10);
      const output = (name: string) => {
        const step = commands.find((step: any) => step.name === `command:["${name}",1]-1`);
        assert.ok(step, `ordinary ${name} must execute`);
        const value = JSON.parse(step.output);
        assert.equal(value.exitCode, 0);
        return value.stdout;
      };
      for (const name of ["install", "lint", "check", "typecheck", "test", "build"]) {
        const step = commands.find((step: any) => step.name === `command:["${name}",1]-1`);
        assert.ok(step, `ordinary ${name} must execute`);
        // The API truncates large command previews; only bounded artifact JSON is parsed below.
        assert.match(step.output, /^\{"exitCode":0,/);
      }
      const producer = JSON.parse(output("publish build"));
      const consumer = JSON.parse(output("verify artifact"));
      assert.equal(producer.name, "demo-build");
      assert.equal(consumer.verified, true);
      assert.deepEqual(producer.files, consumer.files);
      assert.deepEqual(
        consumer.files.map((file: any) => [file.path, file.size]),
        [
          ["dist/index.html", 523],
          ["dist/app.js", 1520],
          ["dist/message.js", 103],
        ],
      );
      for (const file of consumer.files) assert.match(file.sha256, /^[a-f0-9]{64}$/);
      const published = history.steps.find(
        (step: any) => step.name === "publish build:checkpoint-artifact-demo-build-1",
      );
      assert.equal(JSON.parse(published.output).name, "artifact:demo-build");
      assert.match(JSON.parse(published.output).id, /^[a-f0-9-]{36}$/);
      const restored = history.steps.find((step: any) => step.name === "verify artifact:restore-1");
      assert.equal(restored.success, true);
      for (const step of [...commands, published, restored]) {
        assert.equal(step.success, true);
        assert.equal(step.attempts.length, 1);
      }
      for (const step of commands) assert.equal(step.config.retries.limit, 0);
      // Snapshot transport retains the runner's ordinary retry policy; none occurred.
      assert.equal(published.config.retries.limit, 5);
      assert.equal(restored.config.retries.limit, 5);
    },
  );
}
