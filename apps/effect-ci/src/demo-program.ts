import * as CI from "@effect-ci-testbed/ci";
import manifest from "../../../examples/demo/package.json" with { type: "json" };
import { syntaxCommand } from "@effect-ci-testbed/cloudflare/node-syntax-check";

/** Host-selected manifest data; no project module executes inside the host. */
const inferred = CI.fromPackageJson(manifest);
const syntax = CI.check(
  "syntax",
  () =>
    function* () {
      const workspace = yield* inferred.checkout();
      yield* workspace.exec(syntaxCommand);
    },
  { reuse: { scope: "commit" } },
);
const publishBuild = CI.action<CI.WorkspaceArtifact>(
  "publish build",
  () =>
    function* () {
      const workspace = yield* inferred.actions.build!();
      const prepared = yield* workspace.exec("node .cloudflare/ci/artifact.ts create");
      return yield* CI.Artifact.publish(prepared, {
        name: "demo-build",
        paths: [
          "dist/index.html",
          "dist/app.js",
          "dist/message.js",
          ".effect-ci/artifacts/demo-build.json",
        ],
      });
    },
);
const verifyArtifact = CI.action(
  "verify artifact",
  () =>
    function* () {
      const published = yield* publishBuild();
      const restored = yield* CI.Artifact.restore(published);
      return yield* restored.exec("node .cloudflare/ci/artifact.ts verify");
    },
);
export const demoProgram = {
  ...inferred,
  workflow: CI.workflow(manifest.name, function* () {
    yield* syntax();
    yield* inferred.workflow.effect;
    return yield* verifyArtifact();
  }),
};
