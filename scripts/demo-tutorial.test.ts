import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const template = resolve("examples/demo");

test("the demo is a standalone kitchen-sink tour without implicit hosted authority", () => {
  const pkg = JSON.parse(readFileSync(join(template, "package.json"), "utf8"));
  const readme = readFileSync(join(template, "README.md"), "utf8");
  const worker = JSON.parse(readFileSync(join(template, "wrangler.jsonc"), "utf8").replace(/,\s*([}\]])/g, "$1"));
  assert.equal(pkg.name, "effect-ci-tutorial");
  assert.ok(!Object.keys(pkg.scripts).some(key => /setup|teardown/.test(key)));
  assert.ok(Object.values({ ...pkg.dependencies, ...pkg.devDependencies }).every(value => !/workspace:|file:|link:/.test(String(value))));
  assert.equal(worker.assets.directory, "./dist");
  assert.deepEqual(Object.keys(worker).sort(), ["$schema", "assets", "compatibility_date", "name"]);
  assert.match(readme, /mktemp -d/);
  assert.match(readme, /tiged ericclemmons\/effect-ci-testbed\/examples\/demo demo/);
  assert.match(readme, /pnpm link \/path\/to\/effect-ci-testbed\/packages\/cli/);
  assert.doesNotMatch(readme, /export |DEMO_REPO|wrangler |cf-ci --help|ln -s/);
  assert.match(readme, /AI is off/);
  for (const chapter of ["Existing scripts", "Parallel", "Source-aware", "Remote", "Signed", "Slack", "Safe-change", "Previews", "Health", "Auto-fix"])
    assert.match(readme, new RegExp(`^## .*${chapter}`, "m"), `keep the ${chapter} chapter in the conference tour`);
  assert.doesNotMatch(readme, /blacksmith|GitHub environment approvals/i,
    "runner compatibility and GitHub environment gates belong in the capability matrix, not the Effect CI showcase");
  assert.doesNotMatch(readme, /pnpm demo:setup|git worktree|rm -rf|--yes/);
  assert.ok(!existsSync(join(template, ".env")));
  for (const path of ["package-lock.json", "degit.json", "verification", "TALKING-SCRIPT.md", "AGENTS.md"])
    assert.ok(!existsSync(join(template, path)), `keep maintainer scaffolding out of the tutorial: ${path}`);
  assert.doesNotMatch(pkg.scripts.build + pkg.scripts.prebuild, /lint/,
    "an unconditional lint prerequisite must not defeat source-based lint selection");
  const workflow = readFileSync(join(template, ".github/workflows/ci.yml"), "utf8");
  assert.doesNotMatch(workflow, /secrets:|effect-ci-testbed\/\.github|workflow: examples/);
});

test("outside the monorepo: README skips lint/publication, shared TS changes publish once, failed build keeps baseline", { timeout: 120_000 }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "effect-ci-tutorial-test-")));
  cpSync(template, root, { recursive: true, filter: path => !/(?:^|\/)(?:node_modules|dist|\.vite|\.effect-ci|\.wrangler)(?:\/|$)/.test(path) });
  // Install into this copy's own real node_modules. pnpm deliberately refuses
  // a symlinked hoist directory; no app source or install state is inherited.
  mkdirSync(join(root, ".cloudflare/ci"), { recursive: true });
  cpSync(join(root, "tutorial/workflow.ts"), join(root, ".cloudflare/ci/workflow.ts"));
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
  const invoke = (ok = true) => run("pnpm", ["exec", "cf-ci", "run", "--format=json"], ok);
  const parsed = () => JSON.parse(invoke().stdout);
  const pointer = join(root, ".effect-ci/deployed-site/current.json");
  const hasPublish = (result: any) => result.plan.nodes.some((node: any) => node.id === "publish local site");
  assert.ok(hasPublish(parsed()));
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
