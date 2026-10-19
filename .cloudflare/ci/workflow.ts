import * as CI from "@effect-ci-testbed/ci";

// Project discovery is not deployment authority. This allowlist deliberately
// excludes apps/demo, hmd-demo, verification fixtures and the repair/AI apps.
export const platformApps = Object.freeze([
  "demo-site", "release-manager", "github-actions-runner", "example-runner", "effect-ci",
] as const);

const checkout = CI.action("checkout monorepo", function* () {
  const source = yield* CI.Source;
  return () => source.checkout();
});

export const check = CI.check("check monorepo", function* () {
  const workspace = yield* checkout();
  return () => workspace.exec("pnpm check");
});

export const test = CI.check("test core", function* () {
  const workspace = yield* checkout();
  return () => workspace.exec("node --test packages/ci/src/*.test.ts");
});

export const build = CI.action("build monorepo", function* () {
  const workspace = yield* checkout();
  return () => workspace.exec("pnpm build");
});

export const tutorial = CI.check("test and build tutorial", function* () {
  const workspace = yield* checkout();
  return function* () {
    // Normal validation, not tutorial publication or an approval workflow.
    yield* workspace.directory("apps/demo").exec("pnpm test");
    yield* workspace.directory("apps/demo").exec("pnpm build");
  };
});

const validate = () => CI.parallel([check(), test(), build(), tutorial()]);

const appDeployments = platformApps.map(app => CI.action(`deploy ${app}`, function* () {
  yield* validate();
  const workspace = yield* checkout();
  return function* () {
    const directory = workspace.directory(`apps/${app}`);
    // The CI host's build wrapper selects its existing profile; routine CD
    // deliberately does NOT use its Access/secret-reconciling deploy wrapper.
    yield* directory.exec(app === "effect-ci" ? "pnpm build" : "./node_modules/.bin/cf build");
    return yield* directory.exec("./node_modules/.bin/cf deploy --prebuilt --containers-rollout none");
  };
}));

export const deploy = CI.action<void>("deploy platform apps", function* () {
  yield* validate();
  return function* () {
    // Keep app deployments ordered, and stop on the first failed deployment.
    for (const deploy of appDeployments) yield* deploy();
  };
});

export default CI.workflow("monorepo", function* () {
  yield* validate();
  // Ordinary CD, not a second manual deployment workflow. The demo remains
  // validation-only because deployment selection is the platform allowlist.
  yield* CI.when(CI.Condition.all(
    CI.Condition.event("push"),
    CI.Condition.ref("refs/heads/main"),
  ), deploy());
});
