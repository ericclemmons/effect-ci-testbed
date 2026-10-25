import assert from "node:assert/strict";
import test from "node:test";
import { hostProfile } from "../host-profile.ts";
import { standaloneContainerOptions, standaloneProgram } from "./standalone-program.ts";
import { cacheIdentity } from "../../../packages/cloudflare/src/cache-identity.ts";
import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
    "OidcRepositories",
    "TokenLease",
    "WorkspaceContainer",
  ]);
  assert.deepEqual(config.worker.env, {
    EFFECT_CI_PROJECT_ROOT: { type: "text", value: "apps/web" },
  });
  assert.equal(config.containers.length, 1);
  assert.deepEqual(Object.keys(config.containers[0].images), ["workspace"]);
  assert.equal(config.containers[0].images.workspace.dockerfile, "./Dockerfile.standalone");
});

test("standalone selects authored goals in root and nested workspaces without running the default", async () => {
  const repository = mkdtempSync(join(tmpdir(), "effect-ci-hosted-workflow-"));
  try {
  for (const root of [".", "apps/web"]) {
    const project = join(repository, root);
    mkdirSync(join(project, ".cloudflare/ci"), { recursive: true });
    writeFileSync(join(project, "package.json"), JSON.stringify({ type: "module", packageManager: "pnpm@12.8.1" }));
    // Exercise the real frozen CI install, not an ambient local-mode install.
    // Reuse the tracked no-dependency fixture's locked package-manager identity.
    writeFileSync(join(project, "pnpm-lock.yaml"),
      readFileSync(new URL("../../../examples/node-pnpm/pnpm-lock.yaml", import.meta.url), "utf8"));
    writeFileSync(join(project, ".cloudflare/ci/workflow.ts"), `
      import * as CI from "@effect-ci-testbed/ci";
      const setup = CI.action("shared setup", () => function* () {
        const source = yield* CI.Source;
        yield* (yield* source.checkout()).exec("printf setup >> setup.txt");
      });
      export const notes = CI.action("conference notes", () => function* () {
        yield* setup();
        const source = yield* CI.Source;
        return yield* (yield* source.checkout()).exec("printf authored > notes.txt");
      });
      export const build = CI.action("build", () => function* () {
        yield* setup();
        const source = yield* CI.Source;
        return yield* (yield* source.checkout()).exec("printf built > build.txt");
      });
      const all = CI.action("default suite", () => function* () {
        const source = yield* CI.Source;
        return yield* (yield* source.checkout()).exec("printf default > default.txt");
      });
      export default CI.workflow("my conference workflow", () => all());
    `);
    const commands: Array<{ cwd: string; command: string }> = [];
    const run = (targets: ReadonlyArray<string> = []) => CI.runPromise(standaloneProgram(root, targets).workflow, {
      output: "silent",
      ci: true,
      source: { checkout: () => Effect.succeed(CI.Workspace.local(repository)) },
      workspaceFileSystem: {
        readFile: (workspace, path) =>
          Effect.sync(() => { try { return readFileSync(join(workspace.cwd, path), "utf8"); } catch { return undefined; } }),
        exists: (workspace, path) => Effect.sync(() => existsSync(join(workspace.cwd, path))),
      },
      executor: {
        execute: (command) => Effect.sync(() => {
          commands.push({ cwd: command.workspace.cwd, command: command.command });
          // Only the transport's image-local runtime path changes for this local
          // process proof. The real CLI discovers and imports the project itself.
          const local = command.command.replace("/opt/effect-ci/src/hosted.ts",
            fileURLToPath(new URL("../../../packages/cli/src/hosted.ts", import.meta.url)));
          try {
            const stdout = execFileSync("/bin/sh", ["-c", local], { cwd: command.workspace.cwd,
              env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 20_000 });
            return { exitCode: 0, stdout, stderr: "" };
          } catch (error) {
            const failure = error as { status: number; stdout: string; stderr: string };
            return { exitCode: failure.status ?? 1, stdout: failure.stdout, stderr: failure.stderr };
          }
        }),
      },
    });
    await run(["notes", "build"]);
    assert.equal(readFileSync(join(project, "notes.txt"), "utf8"), "authored");
    assert.equal(readFileSync(join(project, "build.txt"), "utf8"), "built");
    assert.equal(readFileSync(join(project, "setup.txt"), "utf8"), "setup");
    assert.equal(existsSync(join(project, "default.txt")), false);
    assert.ok(commands.every((command) => command.cwd === project));
    assert.equal(commands.filter((command) => command.command.includes("install")).length, 1);
    assert.ok(commands.find((command) => command.command.includes("install"))?.command.includes("--frozen-lockfile"));
    await assert.rejects(run(["notes", "missing"]));
    assert.equal(readFileSync(join(project, "setup.txt"), "utf8"), "setup",
      "all requested goals are checked before any authored action executes");
    assert.equal(existsSync(join(project, "default.txt")), false);
    await run();
    assert.equal(readFileSync(join(project, "default.txt"), "utf8"), "default");
  }
  } finally { rmSync(repository, { recursive: true, force: true }); }
});

test("standalone rejects shell syntax and ambiguous goal lists before workspace execution", () => {
  for (const targets of [["--help"], ["notes; echo unsafe"], ["notes", "notes"], Array(17).fill("notes")]) {
    assert.throws(() => standaloneProgram(".", targets), /Invalid project goals/);
  }
});
