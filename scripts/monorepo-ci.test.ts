import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.ok(commands.some(c => c.cwd === "/repo/apps/demo" && c.command === "pnpm test"));
  assert.ok(commands.some(c => c.cwd === "/repo/apps/demo" && c.command === "pnpm build"));
  assert.ok(commands.some(c => c.command === "pnpm check"));
  assert.ok(commands.every(c => !/deploy|publish|approval/.test(c.command)));
});

test("normal main push performs CD for platform apps, never tutorial, repair or verification fixtures", async () => {
  const { commands, run } = await capture(workflow, undefined, { type: "push", ref: "refs/heads/main" });
  await run;
  const deployments = commands.filter(c => c.command.includes("cf deploy"));
  assert.deepEqual(deployments.map(c => c.cwd), platformApps.map(app => `/repo/apps/${app}`));
  assert.ok(deployments.every(c => c.command === "./node_modules/.bin/cf deploy --prebuilt --containers-rollout none"));
  assert.ok(!platformApps.some(app => /^(demo|hmd-demo|repair-.*)$/.test(app)));
  assert.ok(commands.every(c => !/scripts\/deploy|access-only|secret/.test(c.command)));
});

test("failed validation prevents every platform deployment", async () => {
  const { commands, run } = await capture(workflow, "pnpm check", { type: "push", ref: "refs/heads/main" });
  await assert.rejects(run, /Command failed/);
  assert.ok(commands.every(c => !c.command.includes("cf deploy")));
});

test("a failed app build stops CD before that deployment and every later target", async () => {
  const { commands, run } = await capture(workflow,
    "./node_modules/.bin/cf build", { type: "push", ref: "refs/heads/main" });
  await assert.rejects(run, /Command failed/);
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

test("GitHub enables normal root CD and isolates its credentials to executing main pushes", () => {
  const yaml = readFileSync(".github/workflows/monorepo.yml", "utf8");
  assert.match(yaml, /workflow: \.cloudflare\/ci\/workflow\.ts/);
  assert.match(yaml, /cloudflare-deploy: true/);
  assert.doesNotMatch(yaml, /deployPlatform/);
  const reusable = readFileSync(".github/workflows/effect-ci.yml", "utf8");
  const token = reusable.split("\n").find(line => /^\s+CLOUDFLARE_API_TOKEN: \$\{\{/.test(line))!;
  assert.match(token, /inputs\.cloudflare-deploy/);
  assert.match(token, /matrix\.mode == 'execute'/);
  assert.match(token, /github\.event_name == 'push'/);
  assert.match(token, /github\.ref == 'refs\/heads\/main'/);
});
