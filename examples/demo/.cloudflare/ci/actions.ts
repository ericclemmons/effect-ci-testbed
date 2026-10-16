import * as CI from "@effect-ci-testbed/ci";
import { syntaxLocalCommand } from "@effect-ci-testbed/cloudflare/node-syntax-check";

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source;
  return () => source.checkout();
});

const install = CI.action("install", function* () {
  const workspace = yield* checkout();
  return () => workspace.exec("npm ci");
});

const script = (name: string) =>
  CI.check(name, function* () {
    const workspace = yield* install();
    return function* () {
      yield* workspace.exec(`npm run ${name}`);
    };
  });

export const lint = script("lint");
export const check = script("check");
export const typecheck = script("typecheck");

// Each goal owns its prerequisites. Callers request goals, not their setup order.
export const test = CI.check("test", function* () {
  const workspace = yield* install();
  yield* CI.parallel([lint(), check(), typecheck()]);
  return function* () {
    yield* workspace.exec("npm run test");
  };
});

export const build = CI.action("build", function* () {
  const workspace = yield* install();
  yield* CI.parallel([lint(), check(), typecheck()]);
  return () => workspace.exec("npm run build");
});

/** Local deployment preview: consume the checked build, print its real byte
 * identities, and do not upload or claim an external deployment. */
export const deploy = CI.action("deploy preview", function* () {
  yield* CI.parallel([test(), build()]);
  const workspace = yield* build();
  return () => workspace.exec("node .cloudflare/ci/deploy.ts");
});

export const syntax = CI.check(
  "syntax",
  () =>
    function* () {
      const workspace = yield* checkout();
      yield* workspace.exec(syntaxLocalCommand);
    },
  { reuse: { scope: "commit" } },
);

export const verify = CI.action(
  "verify build",
  () =>
    function* () {
      const workspace = yield* build();
      return yield* workspace.exec("node .cloudflare/ci/verify-build.ts");
    },
);
