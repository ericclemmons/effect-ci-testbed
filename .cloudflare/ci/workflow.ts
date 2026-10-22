import * as CI from "@effect-ci-testbed/ci";

// Product apps only. Test hosts live in test/apps; the copy-out tutorial lives
// in examples/demo. Neither is a production CD target.
export const platformApps = ["github-actions-runner", "effect-ci"] as const;

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source;
  return () => source.checkout();
});

const install = CI.action("install", function* () {
  const workspace = yield* checkout();
  return () => workspace.exec("pnpm install --frozen-lockfile");
}, { timeout: "10 minutes", retries: { limit: 0, delay: "1 second" } });

export const check = CI.check("check", function* () {
  const workspace = yield* install();
  return () => workspace.exec("pnpm check");
});

export const test = CI.check("test", function* () {
  const workspace = yield* install();
  return () => workspace.exec("node --test --test-concurrency=2 packages/*/src/*.test.ts apps/*/src/*.test.ts test/apps/*/src/*.test.ts scripts/*.test.ts");
}, { timeout: "30 minutes", checkpoint: "command" });

export const build = CI.action("build", function* () {
  const workspace = yield* install();
  return () => workspace.exec("pnpm build");
});

export const tutorial = CI.check("test and build tutorial", function* () {
  const workspace = (yield* install()).directory("examples/demo");
  return function* () {
    yield* workspace.exec("pnpm test");
    yield* workspace.exec("pnpm build");
  };
});

const validate = () => CI.parallel([check(), test(), build(), tutorial()]);

const deployments = platformApps.map(app => CI.action(`deploy ${app}`, function* () {
  yield* validate();
  const workspace = (yield* install()).directory(`apps/${app}`);
  return function* () {
    yield* workspace.exec("pnpm build");
    yield* workspace.exec("./node_modules/.bin/cf workers triggers deploy --prebuilt");
    return yield* workspace.exec("./node_modules/.bin/cf deploy --prebuilt");
  };
}, { timeout: "15 minutes", retries: { limit: 0, delay: "1 second" } }));

export const deploy = CI.action<void>("deploy", function* () {
  yield* validate();
  return function* () {
    for (const deployment of deployments) yield* deployment();
  };
});

export default CI.workflow("monorepo", function* () {
  yield* validate();
  yield* CI.when(CI.Condition.all(
    CI.Condition.event("push"), CI.Condition.ref("refs/heads/main"),
  ), deploy());
});
