import * as CI from "@effect-ci-testbed/ci";
import { directoryDeployment } from "@effect-ci-testbed/ci/directory-deployment";
import { fileURLToPath, URL } from "node:url";

// A real local destination for the output-comparison lesson, not a claim that
// this publishes to Cloudflare. The hosted adapter owns its own baseline.
const site = directoryDeployment({
  directory: fileURLToPath(new URL("../../.effect-ci/deployed-site", import.meta.url)),
  paths: ["dist/**"],
});

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source;
  return () => source.checkout();
});

export const lint = CI.check("lint", function* () {
  const source = yield* CI.Source;
  return function* () {
    if (yield* source.changed(["**/*.ts", "package.json", "pnpm-lock.yaml"])) {
      yield* (yield* checkout()).exec("pnpm lint");
    }
  };
});

export const test = CI.check("test", function* () {
  const workspace = yield* checkout();
  return () => workspace.exec("pnpm test");
});

export const build = CI.action("build", function* () {
  const workspace = yield* checkout();
  return () => workspace.exec("pnpm build");
});

export const deploy = CI.action("publish local site", function* () {
  const workspace = yield* build();
  return () => site.publish(workspace);
});

export const local: CI.RunConfiguration = { workspaceChanges: site.changes };

export default CI.workflow("demo", function* () {
  yield* CI.parallel([lint(), test()]);
  const workspace = yield* build();
  if (yield* workspace.changed("dist/**")) yield* deploy();
  return workspace;
});
