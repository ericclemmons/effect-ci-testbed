import * as CI from "@effect-ci-testbed/ci";
import manifest from "../../../examples/demo/package.json" with { type: "json" };

/** Host-selected manifest data; no project module executes inside the host. */
export const demoProgram = CI.fromPackageJson(manifest);
