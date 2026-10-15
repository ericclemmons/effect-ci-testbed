import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const revision = "b22f6cfc30b7feb480cb25e30a86576a431276cb";
const cases = [
  {
    name: "missing evidence executes",
    id: "fc3d18a9-cf20-479a-a7c0-c5d67a913443",
    hit: false,
    observed: false,
  },
  {
    name: "valid evidence verifies only the pure check",
    id: "ce9f3370-2e68-43f4-9a30-7e92b89903cb",
    hit: true,
    observed: true,
  },
  {
    name: "invalid signature executes normally",
    id: "56b4f5c0-eefe-4d8a-adfe-728662c767eb",
    hit: false,
    observed: true,
  },
  {
    name: "wrong commit identity executes normally",
    id: "ceeff4ab-0810-45a3-940f-34dd2dcd19e9",
    hit: false,
    observed: true,
  },
  {
    name: "prepared-input digest mismatch executes normally",
    id: "3bd07a31-e01a-4479-bc33-b269b0f4ad0a",
    hit: false,
    observed: true,
  },
  {
    name: "policy digest mismatch executes normally",
    id: "b9f855ba-d484-45b8-8353-7536d001031c",
    hit: false,
    observed: true,
  },
  {
    name: "unknown key identifier executes normally",
    id: "e1888545-1b8c-4e0b-8a17-4c781d0d19b9",
    hit: false,
    observed: true,
  },
] as const;

for (const entry of cases) {
  test(
    `retained native demo: ${entry.name}, without redispatch`,
    { skip: !process.env.LIVE_DEMO_SIGNED_CHECKS },
    () => {
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
      assert.equal(history.output.workflowId, "cf-ci-demo");
      assert.equal(history.output.environment, "cloudflare");
      assert.equal(history.output.nodes.length, 8);
      const syntax = history.output.nodes.find((node: any) => node.id === "syntax");
      assert.equal(syntax.status, entry.hit ? "verified" : "complete");
      assert.ok(
        history.output.nodes
          .filter((node: any) => node.id !== "syntax")
          .every((node: any) => node.status === "complete"),
      );
      const commands = history.steps.filter((step: any) => step.name.startsWith("command:"));
      assert.equal(commands.length, entry.hit ? 7 : 8);
      assert.ok(commands.some((step: any) => step.name === 'command:["syntax",0]-1'));
      assert.equal(
        commands.some((step: any) => step.name === 'command:["syntax",1]-1'),
        !entry.hit,
      );
      for (const action of ["install", "lint", "check", "typecheck", "test", "build"]) {
        assert.ok(commands.some((step: any) => step.name === `command:["${action}",1]-1`));
      }
      for (const step of commands) {
        assert.equal(step.success, true);
        assert.equal(step.attempts.length, 1);
        assert.equal(step.attempts[0].success, true);
        assert.equal(step.config.retries.limit, 0);
        // Native history previews can truncate large stdout; never parse those as full JSON.
        assert.match(step.output, /^\{"exitCode":0,/);
      }
      if (entry.observed) {
        const step = history.steps.find((step: any) => step.name.includes("evidence-observation"));
        assert.equal(step.attempts.length, 1);
        assert.equal(step.config.retries.limit, 0);
        const observation = JSON.parse(step.output).value.data;
        assert.equal(observation.identified, true);
        assert.equal(observation.verified, entry.hit);
        assert.equal(observation.missReason, entry.hit ? null : "signature");
        assert.deepEqual(
          observation.transport
            .filter((item: any) => item.status !== 0)
            .map((item: any) => item.status),
          [200, 200, 200, 200],
        );
      }
    },
  );
}
