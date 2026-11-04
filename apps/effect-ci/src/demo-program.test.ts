import assert from "node:assert/strict";
import test from "node:test";
import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";
import { demoProgram, makeDemoProgram } from "./demo-program.ts";
import { demoRouteAllowed, demoRunAllowed } from "./demo-policy.ts";
import { syntaxCommand } from "@effect-ci-testbed/cloudflare/node-syntax-check";
import { testCommand } from "@effect-ci-testbed/cloudflare/demo-test-check";

test("native demo enrollment selects the same package suite as local discovery, without release or approval", async () => {
  const root = fileURLToPath(new URL("../../../test/fixtures/demo", import.meta.url));
  const result = await CI.runPromise(demoProgram.workflow, {
    mode: "plan",
    output: "silent",
    ci: true,
    source: { checkout: () => Effect.succeed(CI.Workspace.local(root)) },
  });
  assert.equal(result.plan.workflowId, "effect-ci-demo");
  assert.deepEqual(
    result.plan.nodes.map((node) => node.id),
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
    ],
  );
  assert.deepEqual(
    result.plan.nodes.flatMap((node) => node.commands.map((command) => command.command)),
    [
      "npm_config_cache=.effect-ci/cache/npm npm ci",
      syntaxCommand,
      'npm run "lint"',
      'npm run "check"',
      'npm run "typecheck"',
      testCommand,
      'npm run "build"',
      "node .cloudflare/ci/verify-build.ts",
    ],
  );
  assert.ok(result.plan.nodes.every((node) => !node.approval));
});

test("demo enrollment rejects foreign repositories, mutable revisions and unenrolled targets", () => {
  const valid = {
    repository: "https://github.com/ericclemmons/effect-ci-testbed.git",
    revision: "a".repeat(40),
  };
  assert.equal(demoRunAllowed(valid), true);
  assert.equal(
    demoRunAllowed({ ...valid, repository: valid.repository.replace(/\.git$/, "") }),
    true,
  );
  for (const change of [
    { repository: "https://github.com/other/repo.git" },
    { revision: "main" },
    { revision: "a".repeat(39) },
    { target: "release" },
  ]) {
    assert.equal(demoRunAllowed({ ...valid, ...change }), false);
  }
});

test("remote test/build goals share preparation and cannot invoke the default publisher or release", async () => {
  const root = fileURLToPath(new URL("../../../test/fixtures/demo", import.meta.url));
  const program = makeDemoProgram(
    {
      revision: "a".repeat(40),
      publish: async () => {
        throw Error("Selected goals cannot publish");
      },
      prepare: async () => {
        throw Error("Selected goals cannot prepare a release");
      },
    },
    ["test", "build"],
  );
  const result = await CI.runPromise(program.workflow, {
    mode: "plan",
    output: "silent",
    ci: true,
    source: { checkout: () => Effect.succeed(CI.Workspace.local(root)) },
  });
  assert.deepEqual(
    new Set(result.plan.nodes.map((node) => node.id)),
    new Set(["checkout", "install", "typecheck", "test", "build"]),
  );
  const suite = result.plan.nodes.find((node) => node.id === "test")!;
  assert.ok(suite.dependencies.includes("typecheck"));
  assert.deepEqual(
    suite.commands.map((c) => c.command),
    [testCommand],
  );
  assert.equal(result.plan.nodes.filter((node) => node.id === "install").length, 1);
  assert.throws(() => makeDemoProgram(undefined, ["release"]), /goal/);
  assert.throws(() => makeDemoProgram(undefined, []), /goal/);
  assert.throws(() => makeDemoProgram(undefined, ["test", "test"]), /goal/);
  const input = {
    repository: "https://github.com/ericclemmons/effect-ci-testbed.git",
    revision: "a".repeat(40),
  };
  assert.equal(demoRunAllowed({ ...input, targets: ["test", "build"] }), true);
  assert.equal(demoRunAllowed({ ...input, target: "build" }), true);
  assert.equal(demoRunAllowed({ ...input, targets: ["test", "deploy"] }), false);
});

test("demo mount exposes only remote dispatch/status/events, not webhook or approval routes", () => {
  for (const path of [
    "/demo",
    "/demo/",
    "/demo/capabilities",
    "/demo/runs",
    "/demo/runs/owned_123",
    "/demo/runs/owned_123/events",
  ]) {
    assert.equal(demoRouteAllowed(path), true, path);
  }
  for (const path of [
    "/demolition",
    "/demo/webhooks/github",
    "/demo/webhooks/slack",
    "/demo/runs/run/approvals/phase",
    "/demo/runs/%2F",
    "/runs/run",
  ]) {
    assert.equal(demoRouteAllowed(path), false, path);
  }
});
