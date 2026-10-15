import assert from "node:assert/strict";
import test from "node:test";
import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";
import { demoProgram } from "./demo-program.ts";
import { demoRouteAllowed, demoRunAllowed } from "./demo-policy.ts";
import { syntaxCommand } from "@effect-ci-testbed/cloudflare/node-syntax-check";

test("native demo enrollment selects the same package suite as local discovery, without release or approval", async () => {
  const root = fileURLToPath(new URL("../../../examples/demo/", import.meta.url));
  const result = await CI.runPromise(demoProgram.workflow, {
    mode: "plan",
    output: "silent",
    ci: true,
    source: { checkout: () => Effect.succeed(CI.Workspace.local(root)) },
  });
  assert.equal(result.plan.workflowId, "cf-ci-demo");
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
      'npm run "test"',
      'npm run "build"',
      "node .cloudflare/ci/verify-build.ts",
    ],
  );
  assert.ok(result.plan.nodes.every((node) => !node.approval));
});

test("demo enrollment rejects foreign repositories, mutable revisions and actor-selected targets", () => {
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
    { target: "build" },
  ]) {
    assert.equal(demoRunAllowed({ ...valid, ...change }), false);
  }
});

test("demo mount exposes only remote dispatch/status/events, not webhook or approval routes", () => {
  for (const path of [
    "/demo",
    "/demo/",
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
