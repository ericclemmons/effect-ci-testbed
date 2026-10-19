import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import * as Effect from "effect/Effect";
import * as CI from "@effect-ci-testbed/ci";
import workflow, { platformApps } from "../.cloudflare/ci/workflow.ts";

async function capture(definition: CI.Workflow<unknown>, failure?: string | { command: string; cwd: string },
  event: CI.WorkflowEventShape = { type: "pull_request", ref: "refs/heads/main" }) {
  const commands: { cwd: string; command: string }[] = [];
  const run = CI.runPromise(definition, {
    output: "silent",
    event,
    source: { checkout: () => Effect.succeed(CI.Workspace.local("/repo")) },
    executor: { execute: input => {
      commands.push({ cwd: input.workspace.cwd, command: input.command });
      const failed = typeof failure === "string" ? input.command === failure :
        failure && input.command === failure.command && input.workspace.cwd === failure.cwd;
      return Effect.succeed({ exitCode: failed ? 1 : 0, stdout: "", stderr: "" });
    } },
  });
  return { commands, run };
}

test("ordinary root CI tests/builds the tutorial without deployment or approval", async () => {
  const { commands, run } = await capture(workflow);
  await run;
  assert.ok(commands.some(c => c.cwd === "/repo/examples/demo" && c.command === "pnpm test"));
  assert.ok(commands.some(c => c.cwd === "/repo/examples/demo" && c.command === "pnpm build"));
  assert.ok(commands.some(c => c.command === "pnpm check"));
  assert.ok(commands.every(c => !/deploy|publish|approval/.test(c.command)));
});

test("normal main push performs CD for platform apps, never tutorial, repair or verification fixtures", async () => {
  const { commands, run } = await capture(workflow, undefined, { type: "push", ref: "refs/heads/main" });
  await run;
  const deployments = commands.filter(c => c.command.includes("cf deploy"));
  assert.deepEqual(deployments.map(c => c.cwd), platformApps.map(app => `/repo/apps/${app}`));
  assert.ok(deployments.every(c => c.command === "./node_modules/.bin/cf deploy --prebuilt"));
  for (const deployment of deployments) {
    const index = commands.indexOf(deployment);
    assert.deepEqual(commands[index - 1], { cwd: deployment.cwd,
      command: "./node_modules/.bin/cf workers triggers deploy --prebuilt" });
  }
  assert.ok(!platformApps.some(app => /^(demo|hmd-demo|repair-.*)$/.test(app)));
  assert.ok(commands.every(c => !/scripts\/deploy|access-only|secret/.test(c.command)));
});

test("failed trigger registration prevents rollout and every later app", async () => {
  const { commands, run } = await capture(workflow,
    "./node_modules/.bin/cf workers triggers deploy --prebuilt", { type: "push", ref: "refs/heads/main" });
  await assert.rejects(run, /Command failed/);
  assert.ok(commands.some(c => c.command.includes("triggers deploy")));
  assert.ok(commands.every(c => !c.command.includes("cf deploy")));
  assert.ok(commands.every(c => c.cwd !== "/repo/apps/effect-ci"));
});

test("failed validation prevents every platform deployment", async () => {
  const { commands, run } = await capture(workflow, "pnpm check", { type: "push", ref: "refs/heads/main" });
  await assert.rejects(run, /Command failed/);
  assert.ok(commands.every(c => !c.command.includes("cf deploy")));
  assert.deepEqual(commands.map(c => c.command), ["pnpm install --frozen-lockfile", "pnpm check"],
    "do not start test/build/tutorial work after the first required validation fails");
});

test("personal monorepo validations run one at a time without dropping any required work", async () => {
  let active = 0, peak = 0;
  const commands: { cwd: string; command: string }[] = [];
  await CI.runPromise(workflow, {
    output: "silent", event: { type: "pull_request", ref: "refs/heads/main" },
    source: { checkout: () => Effect.succeed(CI.Workspace.local("/repo")) },
    executor: { execute: input => Effect.tryPromise(async () => {
      active++; peak = Math.max(peak, active);
      commands.push({ cwd: input.workspace.cwd, command: input.command });
      try {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { exitCode: 0, stdout: "", stderr: "" };
      } finally { active--; }
    }) },
  });
  assert.equal(peak, 1);
  assert.deepEqual(commands.map(c => c.command), [
    "pnpm install --frozen-lockfile", "pnpm check",
    "node --test --test-concurrency=2 packages/*/src/*.test.ts apps/*/src/*.test.ts test/apps/*/src/*.test.ts scripts/*.test.ts",
    "pnpm build", "pnpm test", "pnpm build",
  ]);
  assert.deepEqual(commands.slice(-2).map(c => c.cwd), ["/repo/examples/demo", "/repo/examples/demo"]);
});

test("a failed app build stops CD before that deployment and every later target", async () => {
  const { commands, run } = await capture(workflow,
    { command: "pnpm build", cwd: "/repo/apps/github-actions-runner" }, { type: "push", ref: "refs/heads/main" });
  await assert.rejects(run, /Command failed/);
  assert.ok(commands.some(c => c.cwd === "/repo" && c.command === "pnpm build"), "root validation passed first");
  assert.ok(commands.some(c => c.cwd === "/repo/apps/github-actions-runner" && c.command === "pnpm build"));
  assert.ok(commands.every(c => !c.command.includes("cf deploy")));
  assert.ok(!commands.some(c => c.cwd === "/repo/apps/effect-ci"));
});

test("feature pushes and manual runs validate without automatic production deployment", async () => {
  for (const event of [
    { type: "push", ref: "refs/heads/feature/demo" },
    { type: "workflow_dispatch", ref: "refs/heads/main" },
    { type: "push" },
  ] satisfies CI.WorkflowEventShape[]) {
    const { commands, run } = await capture(workflow, undefined, event);
    await run;
    assert.ok(commands.every(c => !c.command.includes("cf deploy")));
  }
});

test("every product app is in ordinary CD and test apps stay separate", () => {
  assert.deepEqual([...platformApps].sort(), readdirSync("apps").sort());
  assert.ok(readdirSync("test/apps").includes("repair-events"));
  assert.ok(readdirSync("examples/demo").includes("tutorial"));
});

test("native Cloudflare runs the same root graph, without a custom deployment protocol", () => {
  const native = readFileSync("apps/effect-ci/src/monorepo-workflow.ts", "utf8");
  assert.match(native, /from "\.\.\/\.\.\/\.\.\/\.cloudflare\/ci\/workflow\.ts"/);
  assert.match(native, /return workflow;/);
  assert.doesNotMatch(native, /publishPlatform|nativeMonorepoProgram|finalize:|versions\//);
});

test("GitHub runs supporting checks without Cloudflare deployment credentials", () => {
  const yaml = readFileSync(".github/workflows/monorepo.yml", "utf8");
  assert.match(yaml, /workflow: \.cloudflare\/ci\/checks\.ts/);
  assert.doesNotMatch(yaml, /cloudflare-deploy|deployPlatform/);
  const reusable = readFileSync(".github/workflows/effect-ci.yml", "utf8");
  assert.doesNotMatch(reusable, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
  const recipes = readFileSync(".github/workflows/e2e.yml", "utf8");
  assert.doesNotMatch(recipes, /^\s+uses:\s+\.github\//m, "local reusable workflow references require ./");
});
