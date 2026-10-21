import assert from "node:assert/strict";
import test from "node:test";
import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import { createDemoProgram } from "../../../examples/demo/tutorial/program.ts";
import { showcaseProgram } from "./showcase-program.ts";
import { demoSite, demoSiteUrl, type DemoAssets } from "@effect-ci-testbed/cloudflare/demo-site";
import { showcaseTestCommand } from "./showcase-check-policy.ts";

test("one authored demo validates its build before publication and waits for a human before release", async () => {
  const calls: string[] = [];
  let decide!: (result: CI.ApprovalResult) => void;
  let waiting!: () => void;
  const requested = new Promise<void>(resolve => { waiting = resolve; });
  const program = createDemoProgram({
    publishStep: "publish preview",
    publish: workspace => Effect.sync(() => {
      assert.equal(workspace.cwd, "/workspace/demo");
      calls.push("preview");
      return { revision: "a".repeat(40), digest: "b".repeat(64) };
    }),
    release: receipt => Effect.gen(function* () {
      assert.equal(receipt.revision, "a".repeat(40));
      yield* (yield* CI.Approval).request({ title: "Progress?", summary: "The checked preview is ready." });
      calls.push("release");
      return receipt;
    }),
  });
  const run = CI.runPromise(program.workflow, {
    output: "silent", ci: true,
    source: { checkout: () => Effect.succeed(CI.Workspace.local("/workspace/demo")) },
    executor: { execute: command => Effect.sync(() => {
      calls.push(command.command);
      return { exitCode: 0, stdout: "", stderr: "" };
    }) },
    workspaceChanges: { changed: () => Effect.succeed(true) },
    approval: { request: () => Effect.promise(() => new Promise<CI.ApprovalResult>(resolve => {
      decide = resolve;
      waiting();
    })) },
  });
  await requested;
  assert.ok(calls.includes("pnpm lint"));
  assert.ok(calls.includes("pnpm test"));
  assert.ok(calls.indexOf("pnpm build") > calls.indexOf("pnpm test"));
  assert.ok(calls.indexOf("preview") > calls.indexOf("pnpm build"));
  assert.equal(calls.includes("release"), false);
  decide({ decision: "approved", actor: "LOCAL-FAKE-HUMAN" });
  const result = await run;
  assert.equal(calls.filter(call => call === "pnpm build").length, 1);
  assert.equal(calls.filter(call => call === "release").length, 1);
  assert.ok(result.plan.nodes.some(node => node.id === "progressive rollout"));
});

test("the hosted adapter publishes the checked app bytes and independently verifies their immutable URL", async () => {
  const revision = "a".repeat(40);
  const assets: DemoAssets = { "index.html": "<h1>Actual app</h1>", "app.js": "export const app=1", "message.js": "export const message='hi'" };
  const site = await demoSite(revision, assets);
  for (const failure of [undefined, "test", "build", "extra-asset", "publication", "served-bytes"] as const) {
    const commands: string[] = [], reads: string[] = [];
    let publications = 0;
    const program = showcaseProgram({ revision,
      publish: async (requestedRevision, bytes) => {
        publications++;
        assert.equal(requestedRevision, revision);
        assert.deepEqual(bytes, assets);
        return { revision, digest: failure === "publication" ? "b".repeat(64) : site.digest, url: demoSiteUrl(site) };
      },
      transport: (async (url: string) => {
        reads.push(url);
        const name = url.split("/").at(-1)! as keyof DemoAssets;
        return new Response(failure === "served-bytes" ? "wrong" : assets[name], {
          headers: { "x-site-revision": revision, "x-site-digest": site.digest },
        });
      }) as typeof fetch,
    });
    const run = CI.runPromise(program.workflow, {
      output: "silent", ci: true,
      source: { checkout: () => Effect.succeed(CI.Workspace.local("/workspace/demo")) },
      workspaceFileSystem: {
        readFile: (_, path) => Effect.succeed(path === "package.json" ? '{"packageManager":"pnpm@12.8.1"}' :
          path === "pnpm-lock.yaml" ? "lockfileVersion: 9.0" : assets[path.slice("dist/".length) as keyof DemoAssets]),
        exists: (_, path) => Effect.succeed(path === "pnpm-lock.yaml"),
      },
      executor: { execute: ({ command }) => Effect.sync(() => {
        commands.push(command);
        return { exitCode: command === `pnpm ${failure}` || failure === "test" && command === showcaseTestCommand || failure === "extra-asset" && command.includes("verify-build.cjs") ? 7 : 0, stdout: "", stderr: "" };
      }) },
    });
    if (failure) await assert.rejects(run);
    else {
      const result = await run;
      assert.equal(result.value?.digest, site.digest);
      assert.equal(commands.filter(command => command.includes("install")).length, 1);
      assert.ok(commands.find(command => command.includes("install"))?.includes("--frozen-lockfile"));
      assert.deepEqual(reads.sort(), Object.keys(assets).map(name => demoSiteUrl(site).replace("index.html", name)).sort());
    }
    assert.equal(publications, failure === "test" || failure === "build" || failure === "extra-asset" ? 0 : 1);
    if (failure === "test") assert.equal(commands.includes("pnpm build"), false);
  }
});
