import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const template = resolve("examples/demo");

test("outside the monorepo: README skips lint/publication, shared TS changes publish once, failed build keeps baseline", { timeout: 120_000 }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "effect-ci-tutorial-test-")));
  cpSync(template, root, { recursive: true, filter: path => !/(?:^|\/)(?:node_modules|dist|\.vite|\.effect-ci|\.wrangler)(?:\/|$)/.test(path) });
  // Install into this copy's own real node_modules. pnpm deliberately refuses
  // a symlinked hoist directory; no app source or install state is inherited.
  mkdirSync(join(root, ".cloudflare/ci"), { recursive: true });
  cpSync(join(root, "tutorial/workflow.ts"), join(root, ".cloudflare/ci/workflow.ts"));
  cpSync(join(root, "tutorial/program.ts"), join(root, ".cloudflare/ci/program.ts"));
  // This is a NEW independent Git repository, not the checkout which launched
  // the test. An inherited GITHUB_SHA would correctly make its local diff
  // unknown/stale and run lint. Do not import the parent's source identity,
  // event, approval, transport or remote authority into this tutorial fixture.
  // Keep unrelated parent metadata present even outside GitHub so removing
  // this isolation reproduces the hosted failure in a local run as well.
  const parentEnvironment = { ...process.env, GITHUB_SHA: "f".repeat(40),
    GITHUB_REF: "refs/pull/123/merge", EFFECT_CI_REVISION: "e".repeat(40),
    EFFECT_CI_EVENT: "pull_request" };
  const environment = {
    ...Object.fromEntries(Object.entries(parentEnvironment).filter(([name]) =>
      !name.startsWith("GITHUB_") && !name.startsWith("EFFECT_CI_"))),
    AI_AGENT: "true", EFFECT_CI_REMOTE_URL: "", EFFECT_CI_REMOTE_TOKEN: "",
  };
  const run = (command: string, args: string[], ok = true) => {
    const result = spawnSync(command, args, { cwd: root, env: environment, encoding: "utf8", timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
    if (ok) assert.equal(result.status, 0, result.stdout + result.stderr + String(result.error ?? ""));
    return result;
  };
  run("pnpm", ["install", "--prefer-offline"]);
  run("pnpm", ["check"]);
  run("pnpm", ["link", resolve("packages/cli"), resolve("packages/ci")]);
  run("git", ["init", "--initial-branch=main"]);
  run("git", ["config", "user.name", "Local tutorial test"]);
  run("git", ["config", "user.email", "tutorial@example.invalid"]);
  run("git", ["add", "."]);
  run("git", ["commit", "-m", "Start tutorial"]);
  run("git", ["remote", "add", "origin", "https://github.com/example/tutorial.git"]);
  run("git", ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  run("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  const invoke = (ok = true) => run("pnpm", ["exec", "effect-ci", "run", "--format=json"], ok);
  const parsed = () => JSON.parse(invoke().stdout);
  const pointer = join(root, ".effect-ci/deployed-site/current.json");
  const hasPublish = (result: any) => result.plan.nodes.some((node: any) => node.id === "publish local site");
  assert.ok(hasPublish(parsed()));
  const assets = readdirSync(join(root, "dist"), { recursive: true })
    .filter(path => statSync(join(root, "dist", String(path))).isFile()).sort();
  assert.deepEqual(assets, ["app.js", "index.html", "message.js"],
    "the hosted publisher must serve every emitted artifact, including shared JavaScript dependencies");
  const first = readFileSync(pointer, "utf8");
  assert.ok(!hasPublish(parsed()));
  assert.equal(readFileSync(pointer, "utf8"), first);
  run("git", ["switch", "-c", "demo/readme"]);
  appendFileSync(join(root, "README.md"), "\nA README-only change.\n");
  run("git", ["add", "README.md"]);
  run("git", ["commit", "-m", "README only"]);
  const readme = parsed();
  assert.ok(!hasPublish(readme));
  assert.ok(readme.plan.nodes.flatMap((node: any) => node.commands).every((command: any) => command.command !== "pnpm lint"));
  const appSource = readFileSync(join(root, "src/app.ts"), "utf8");
  writeFileSync(join(root, "packages/greeting/message.ts"), 'export const greeting = "Shared code ships too.";\n');
  run("git", ["add", "packages/greeting/message.ts"]);
  run("git", ["commit", "-m", "Shared module change"]);
  const shared = parsed();
  assert.ok(hasPublish(shared));
  assert.ok(shared.plan.nodes.flatMap((node: any) => node.commands).some((command: any) => command.command === "pnpm lint"));
  assert.equal(readFileSync(join(root, "src/app.ts"), "utf8"), appSource);
  const second = readFileSync(pointer, "utf8");
  assert.notEqual(second, first);
  // Follow the bundler's actual module graph; the message can live in a
  // content-hashed shared chunk rather than directly in the entry file.
  assert.equal(run(process.execPath, ["--input-type=module", "-e",
    'import("./dist/message.js").then(m => console.log(m.message))']).stdout.trim(), "Shared code ships too.");
  assert.ok(!hasPublish(parsed()));
  writeFileSync(join(root, "packages/greeting/message.ts"), "export const greeting = ;\n");
  assert.notEqual(invoke(false).status, 0);
  assert.equal(readFileSync(pointer, "utf8"), second);
  // Keep this bounded test directory for debugging a failing run; never remove
  // a user-supplied directory or any shared runtime/remote resource.
});
