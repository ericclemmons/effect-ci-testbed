import assert from "node:assert/strict";
import test from "node:test";
import { hostProfile } from "../host-profile.ts";
import { standaloneContainerOptions, standaloneProgram } from "./standalone-program.ts";
import { cacheIdentity } from "../../../packages/cloudflare/src/cache-identity.ts";
import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("standalone uid/non-login policy cannot restore the old root runner's transport snapshot", async () => {
  assert.equal(standaloneContainerOptions.loginShell, false);
  assert.match(standaloneContainerOptions.readyCommand, /process\.getuid\(\)!==1000/);
  const request = {
    repository: "https://github.com/acme/private.git",
    key: "acme/private",
    paths: ["node_modules/.vite/task-cache"],
    files: [],
  };
  const legacy = await cacheIdentity({
    ...request,
    container: { image: "workspace", instance: "standard-1" },
  });
  const current = await cacheIdentity({ ...request, container: standaloneContainerOptions });
  assert.notEqual(current, legacy);
});

test("standalone deployment has its own configurable identity; existing demo defaults stay intact", () => {
  assert.deepEqual(hostProfile({}), { profile: "demo" });
  assert.deepEqual(
    hostProfile({
      EFFECT_CI_PROFILE: "standalone",
      EFFECT_CI_WORKER_NAME: "acme-ci",
      EFFECT_CI_PROJECT_ROOT: "apps/web",
    }),
    { profile: "standalone", name: "acme-ci", root: "apps/web" },
  );
  for (const input of [
    { EFFECT_CI_PROFILE: "typo" },
    { EFFECT_CI_PROFILE: "standalone", EFFECT_CI_PROJECT_ROOT: "../other" },
    { EFFECT_CI_PROFILE: "standalone", EFFECT_CI_PROJECT_ROOT: "/workspace" },
    { EFFECT_CI_PROFILE: "standalone", EFFECT_CI_WORKER_NAME: "bad/name" },
  ])
    assert.throws(() => hostProfile(input));
});

test("the actual standalone deployment config has no cross-Worker demo dependency", () => {
  const config = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import config from "./cloudflare.config.ts";console.log(JSON.stringify(config))',
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          EFFECT_CI_PROFILE: "standalone",
          EFFECT_CI_WORKER_NAME: "acme-ci",
          EFFECT_CI_PROJECT_ROOT: "apps/web",
        },
      },
    ),
  );
  assert.equal(config.worker.name, "acme-ci");
  assert.equal(config.worker.entrypoint, "./src/standalone-worker.ts");
  assert.deepEqual(Object.keys(config.worker.exports).sort(), [
    "EffectCIWorkflow",
    "GitCheckoutOutbound",
    "WorkspaceContainer",
  ]);
  assert.deepEqual(config.worker.env, {
    EFFECT_CI_PROJECT_ROOT: { type: "text", value: "apps/web" },
  });
  assert.equal(config.containers.length, 1);
  assert.deepEqual(Object.keys(config.containers[0].images), ["workspace"]);
  assert.equal(config.containers[0].images.workspace.dockerfile, "./Dockerfile.standalone");
});

test("standalone build uses another project's package manager and root without demo capabilities", async () => {
  for (const goals of [undefined, ["test", "build"]]) {
    const commands: Array<{ cwd: string; command: string }> = [];
    const result = await CI.runPromise(standaloneProgram("apps/web", goals).workflow, {
      output: "silent",
      source: { checkout: () => Effect.succeed(CI.Workspace.local("/acme")) },
      workspaceFileSystem: {
        readFile: (workspace, path) =>
          Effect.succeed(
            path === "package.json" && workspace.cwd === "/acme/apps/web"
              ? JSON.stringify({ packageManager: "pnpm@12.8.1", scripts: { build: "vite build" } })
              : undefined,
          ),
        exists: (workspace, path) =>
          Effect.succeed(workspace.cwd === "/acme/apps/web" && path === "pnpm-lock.yaml"),
      },
      executor: {
        execute: (command) => {
          commands.push({ cwd: command.workspace.cwd, command: command.command });
          return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
        },
      },
    });
    assert.deepEqual(
      result.plan.nodes.map((node) => node.id).sort(),
      ["checkout", "install", ...(goals ?? ["build"])].sort(),
    );
    assert.ok(commands.length >= 2);
    assert.ok(commands.every((command) => command.cwd === "/acme/apps/web"));
    assert.ok(
      commands.some(
        (command) => command.command.includes("pnpm") && command.command.includes("install"),
      ),
    );
    assert.ok(
      commands.some(
        (command) => command.command.includes("pnpm") && command.command.includes("build"),
      ),
    );
    assert.equal(commands.filter((command) => command.command.includes("install")).length, 1);
  }
  assert.throws(() => standaloneProgram(".", ["release"]));
});
