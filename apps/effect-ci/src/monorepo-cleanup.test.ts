import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
const bundle = await build({
  entryPoints: [new URL("./monorepo-workflow.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "node", format: "esm", target: "esnext",
  plugins: [{ name: "capture-monorepo-lifecycle", setup(build: any) {
    build.onResolve({ filter: /\.cloudflare\/ci\/workflow\.ts$/ }, () => ({
      path: new URL("../../../.cloudflare/ci/workflow.ts", import.meta.url).href, external: true,
    }));
    build.onResolve({ filter: /^@effect-ci-testbed\/github-cloudflare$/ }, () => ({ path: "host", namespace: "capture" }));
    build.onLoad({ filter: /.*/, namespace: "capture" }, () => ({ contents: `
      export const workflowEntrypoint=()=>class {
        constructor(ctx){this.ctx=ctx;}
        async run(){if(this.ctx.failure)throw this.ctx.failure;return {success:true};}
      };`, loader: "js" }));
  } }],
});
const { MonorepoCIWorkflow } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function fixture(failure?: Error, stopFailure?: "reject" | "pending") {
  const stops: string[] = [], allowed: string[] = [], checkpoints: { name: string; error?: unknown }[] = [];
  const primary = failure;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const workflow = new MonorepoCIWorkflow({ failure, exports: { WorkspaceContainer: {
    getByName(name: string) { return {
      allowMainDeployment: async () => { allowed.push(name); },
      stop: async () => {
        stops.push(name);
        if (name === "fixture") {
          if (stopFailure === "reject") throw Error("private-provider-detail must not escape");
          if (stopFailure === "pending") await pending;
        }
      },
    }; },
  } } });
  const step = { do: async (name: string, _options: unknown, body: () => Promise<unknown>) => {
    const entry: { name: string; error?: unknown } = { name }; checkpoints.push(entry);
    try {
      const execution = body();
      // Model the native step deadline without waiting thirty seconds. The
      // outstanding provider operation may finish later; it is never replayed.
      if (name === "monorepo:cleanup" && stopFailure === "pending")
        return await Promise.race([execution, Promise.reject(Error("cleanup deadline"))]);
      return await execution;
    } catch (error) { entry.error = error; throw error; }
  } };
  const run = () => workflow.run({ instanceId: "fixture", payload: {
    trigger: "github", repository: "https://github.com/ericclemmons/effect-ci-testbed.git",
    repositoryName: "ericclemmons/effect-ci-testbed", installationId: 165265172,
    revision: "a".repeat(40), ref: "refs/heads/main",
  } }, step);
  return { run, stops, allowed, checkpoints, primary, release };
}

test("failed cleanup preserves the original CI failure and attempts every independent container once", async () => {
  const f = fixture(Error("install deadline"), "reject");
  await assert.rejects(f.run(), error => error === f.primary);
  assert.equal(f.allowed.length, 2);
  assert.equal(f.stops.length, 10);
  assert.equal(new Set(f.stops).size, 10);
  assert.ok(f.stops.includes("fixture:step=deploy effect-ci"));
  assert.ok(f.checkpoints.find(entry => entry.name === "monorepo:cleanup")?.error);
});

test("a pending provider stop cannot serialize away the remaining cleanup or replace the CI error", async () => {
  const f = fixture(Error("install deadline"), "pending");
  try {
    await assert.rejects(f.run(), error => error === f.primary);
    assert.equal(f.stops.length, 10);
    assert.equal(new Set(f.stops).size, 10);
  } finally { f.release(); }
});

test("cleanup failure after otherwise successful CI remains a failure with no provider detail leak", async () => {
  const f = fixture(undefined, "reject");
  await assert.rejects(f.run(), error => error instanceof Error &&
    /could not stop/.test(error.message) && !error.message.includes("must not escape"));
  assert.equal(f.stops.length, 10);
});

test("successful CI and cleanup preserve the original success result", async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { success: true });
  assert.equal(f.stops.length, 10);
});
