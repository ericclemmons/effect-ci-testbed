import * as CI from "@effect-ci-testbed/ci";
import { syntaxLocalCommand } from "@effect-ci-testbed/cloudflare/node-syntax-check";

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

const script = (name: string) =>
  CI.action(
    name,
    () =>
      function* () {
        const workspace = yield* install();
        return yield* workspace.exec(`npm run ${name}`);
      },
  );

export const lint = script("lint");
export const check = script("check");
export const typecheck = script("typecheck");
export const test = script("test");
export const build = script("build");

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
