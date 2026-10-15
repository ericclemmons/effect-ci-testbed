import * as CI from "@effect-ci-testbed/ci";
import { syntaxCommand } from "@effect-ci-testbed/cloudflare/node-syntax-check";

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source;
  return () => source.checkout();
});

const install = CI.action(
  "install",
  () =>
    function* () {
      const workspace = yield* checkout();
      return yield* workspace.exec("npm ci");
    },
);

export const lint = CI.action(
  "lint",
  () =>
    function* () {
      const workspace = yield* install();
      return yield* workspace.exec("npm run lint");
    },
);

export const build = CI.action(
  "build",
  () =>
    function* () {
      const workspace = yield* install();
      return yield* workspace.exec("npm run build");
    },
);

export const syntax = CI.check(
  "syntax",
  () =>
    function* () {
      const workspace = yield* checkout();
      yield* workspace.exec(syntaxCommand);
    },
  { reuse: { scope: "commit" } },
);

const publishBuild = CI.action<CI.WorkspaceArtifact>(
  "publish build",
  () =>
    function* () {
      const workspace = yield* build();
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

export const artifact = CI.action(
  "verify artifact",
  () =>
    function* () {
      const published = yield* publishBuild();
      const restored = yield* CI.Artifact.restore(published);
      return yield* restored.exec("node .cloudflare/ci/artifact.ts verify");
    },
);
