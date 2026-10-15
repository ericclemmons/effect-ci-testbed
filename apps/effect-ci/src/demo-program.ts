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
export const demoProgram = {
  ...inferred,
  workflow: CI.workflow(manifest.name, function* () {
    yield* syntax();
    return yield* inferred.workflow.effect;
  }),
};
