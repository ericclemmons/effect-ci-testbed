import * as CI from "@effect-ci-testbed/ci";
import {
  directoryDeployment,
  type DirectoryDeploymentReceipt,
} from "@effect-ci-testbed/ci/directory-deployment";
import { fileURLToPath, URL } from "node:url";

const site = directoryDeployment({
  directory: fileURLToPath(new URL("../../.effect-ci/deployed-site", import.meta.url)),
  paths: [".cloudflare/output/**"],
});
export const local: CI.RunConfiguration = { workspaceChanges: site.changes };

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source;
  return () => source.checkout();
});

const install = CI.action("install", function* () {
  const workspace = yield* checkout();
  const pm = yield* CI.PackageManager.JavaScript(workspace);
  return () => pm.install();
});

export const lint = CI.check("lint", function* () {
  const workspace = yield* install();
  const pm = yield* CI.PackageManager.JavaScript(workspace);
  return () => pm.exec("vp lint");
});

export const build = CI.action("build", function* () {
  const workspace = yield* install();
  const pm = yield* CI.PackageManager.JavaScript(workspace);
  return () => pm.exec("vp run --cache build");
});

const deploy = CI.action<DirectoryDeploymentReceipt | undefined>(
  "publish local site",
  function* () {
    const workspace = yield* build();
    return function* () {
      const approval = yield* CI.Approval;
      yield* approval.request({
        title: "Publish the walkthrough?",
        summary: "The build passed and its output changed.",
      });
      return yield* site.publish(workspace);
    };
  },
);

export default CI.workflow("walkthrough", function* () {
  const source = yield* CI.Source;
  const changes = yield* source.changes();
  if (
    changes.status === "known" &&
    changes.paths.length > 0 &&
    changes.paths.every((path) => path.endsWith(".md"))
  )
    return;
  yield* CI.parallel([lint(), build()]);
  const workspace = yield* build();
  if (!(yield* workspace.changed(".cloudflare/output/**"))) return;
  return yield* deploy();
});
