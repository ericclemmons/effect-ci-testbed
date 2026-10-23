import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as Effect from "effect/Effect";
import * as CI from "@effect-ci-testbed/ci";
import workflow from "../../../.cloudflare/ci/workflow.ts";
import { RunCard } from "../../../packages/github-cloudflare/src/run-card.ts";

// Capture the actual host's presentation options, without starting a Workflow.
const require = createRequire(import.meta.url);
const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
const bundle = await build({
  stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import './monorepo-workflow.ts';
    import {options} from '@effect-ci-testbed/github-cloudflare';
    export const progressSteps=parameters=>options.slackProgressSteps?.(parameters);
  ` },
  bundle: true, write: false, platform: "node", format: "esm", target: "esnext",
  plugins: [{ name: "capture-host-options", setup(build: any) {
    build.onResolve({ filter: /^@effect-ci-testbed\/github-cloudflare$/ }, () => ({ path: "host", namespace: "capture" }));
    build.onLoad({ filter: /.*/, namespace: "capture" }, () => ({ contents:
      "export let options;export const workflowEntrypoint=(definition,config)=>{options=config;return class {};};", loader: "js" }));
  } }],
});
const { progressSteps } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("native install uses the recovery-aware single-command boundary with its original deadline and zero retries", async () => {
  const outerActions: string[] = [];
  const result = await CI.runPromise(workflow, {
    output: "silent", event: { type: "pull_request" },
    source: { checkout: () => Effect.succeed(CI.Workspace.local("/repo")) },
    executor: { handlesStepOptions: true, execute: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }) },
    actionExecutor: { execute: request => {
      outerActions.push(request.stepId);
      return request.run(1);
    } },
  });
  const install = result.plan.nodes.find(node => node.id === "install")!;
  assert.deepEqual(install.options, { timeout: "10 minutes", retries: { limit: 0, delay: "1 second" }, checkpoint: "command" });
  assert.deepEqual(install.commands.map(command => command.command), ["pnpm install --frozen-lockfile"],
    "the unchanged deadline covers the same one command, not a newly enlarged multi-command body");
  assert.ok(!outerActions.includes("install"), "a long outer action must not hide its recorded command result");
});

test("monorepo parent keeps its segmented bar for validation and actual main deployment steps", async () => {
  for (const [trigger, ref, total] of [
    ["github", "refs/heads/feature/demo", 7],
    ["github", "refs/heads/main", 9],
    ["remote", "refs/heads/main", 7],
  ] as const) {
    const steps = progressSteps({ trigger, ref });
    const card = new RunCard({ instanceId: "fixture", repository: "owner/repo", revision: "a".repeat(40) }, { progressSteps: steps });
    const initial = card.render({ statusOnly: true }).text;
    assert.match(initial, new RegExp(`${"▱".repeat(total)} 0/${total}$`));
    const seen = new Set<string>();
    const runningFrames: string[] = [];
    const result = await CI.runPromise(workflow, {
      output: "silent", event: { type: trigger === "github" ? "push" : "workflow_dispatch", ref },
      source: { checkout: () => Effect.succeed(CI.Workspace.local("/repo")) },
      executor: { execute: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }) },
      onEvent: event => {
        card.update(event);
        if (event.type === "step.status") {
          seen.add(event.stepId);
          if (event.status === "running") runningFrames.push(card.render({ statusOnly: true }).text);
        }
      },
    });
    assert.deepEqual(new Set(steps), seen, "the declared total must match the actual selected workflow");
    assert.deepEqual(new Set(steps), new Set(result.plan.nodes.map(node => node.id)));
    assert.equal(steps.length, total);
    assert.ok(runningFrames.length > 0);
    assert.ok(runningFrames.every(frame => /[▰▱]/.test(frame) && !/steps? done/.test(frame)));
    assert.match(card.render({ statusOnly: true }).text, new RegExp(`${"▰".repeat(total)} ${total}/${total}$`));
    const details = JSON.stringify(card.renderDetails().blocks);
    assert.match(details, /"type":"table"/);
    assert.doesNotMatch(details, /complete/);
  }
});

test("failed monorepo validation retains the bar without claiming a successful deployment", async () => {
  const card = new RunCard({ instanceId: "failed-fixture", repository: "owner/repo", revision: "a".repeat(40) }, {
    progressSteps: progressSteps({ trigger: "github", ref: "refs/heads/main" }),
  });
  const commands: string[] = [];
  await assert.rejects(CI.runPromise(workflow, {
    output: "silent", event: { type: "push", ref: "refs/heads/main" },
    source: { checkout: () => Effect.succeed(CI.Workspace.local("/repo")) },
    executor: { execute: input => {
      commands.push(input.command);
      return Effect.succeed({ exitCode: input.command.startsWith("node --test") ? 7 : 0, stdout: "", stderr: "" });
    } },
    onEvent: event => { card.update(event); },
  }), /Command failed/);
  const parent = card.render({ statusOnly: true }).text;
  assert.match(parent, /^✗ monorepo/);
  assert.match(parent, /[▰▱].*\/9$/);
  assert.doesNotMatch(parent, /steps? done/);
  assert.ok(commands.every(command => !command.includes("cf deploy")));
});
