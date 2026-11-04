import * as CI from "@effect-ci-testbed/ci";

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source;
  return () => source.checkout();
});

const install = CI.action("install", function* () {
  const workspace = yield* checkout();
  const pm = yield* CI.PackageManager.JavaScript(workspace);
  return () => pm.install();
});

export const build = CI.action("build", function* () {
  const workspace = yield* install();
  const pm = yield* CI.PackageManager.JavaScript(workspace);
  return () => pm.exec("vp run build");
});

export default CI.workflow("walkthrough", function* () {
  const source = yield* CI.Source;
  const changes = yield* source.changes();
  if (
    changes.status === "known" &&
    changes.paths.length > 0 &&
    changes.paths.every((path) => path.endsWith(".md"))
  )
    return;
  return yield* build();
});
