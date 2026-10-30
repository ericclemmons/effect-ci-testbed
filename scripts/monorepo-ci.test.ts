import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import * as Effect from "effect/Effect";
import * as CI from "@effect-ci-testbed/ci";
import workflow, { platformApps } from "../.cloudflare/ci/workflow.ts";

async function capture(definition: CI.Workflow<unknown>, failure?: string,
  event: CI.WorkflowEventShape = { type: "pull_request", ref: "refs/heads/main" }) {
  const commands: { cwd: string; command: string }[] = [];
  const run = CI.runPromise(definition, {
    output: "silent",
    event,
    source: { checkout: () => Effect.succeed(CI.Workspace.local("/repo")) },
    executor: { execute: input => {
      commands.push({ cwd: input.workspace.cwd, command: input.command });
      return Effect.succeed({ exitCode: input.command === failure ? 1 : 0, stdout: "", stderr: "" });
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
});

test("a failed app build stops CD before that deployment and every later target", async () => {
  const { commands, run } = await capture(workflow,
    "pnpm build", { type: "push", ref: "refs/heads/main" });
  await assert.rejects(run, error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2, "both independent build validations retain their failures");
    for (const failure of error.errors) {
      assert.ok(failure instanceof CI.CommandError);
      assert.equal(failure.command, "pnpm build");
      assert.equal(failure.exitCode, 1);
    }
    return true;
  });
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

test("every product app has main-branch CD and test apps stay separate", () => {
  const docs = JSON.parse(readFileSync("apps/docs/builds.json", "utf8"));
  assert.equal(docs.provider, "Cloudflare Workers Builds");
  assert.equal(docs.branch, "main");
  assert.equal(docs.worker, "effect-ci-docs");
  assert.equal(docs.buildCommand, "pnpm docs:build");
  assert.equal(docs.deployCommand, "pnpm --filter @effect-ci-testbed/docs exec cf deploy --prebuilt");
  assert.deepEqual([...platformApps, "docs"].sort(), readdirSync("apps").sort());
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
