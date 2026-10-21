import * as CI from "@effect-ci-testbed/ci";
import { directoryDeployment } from "@effect-ci-testbed/ci/directory-deployment";
import { fileURLToPath, URL } from "node:url";
import { createDemoProgram } from "./program.ts";

// A real local destination for the output-comparison lesson, not a claim that
// this publishes to Cloudflare. The hosted adapter owns its own baseline.
const site = directoryDeployment({
  directory: fileURLToPath(new URL("../../.effect-ci/deployed-site", import.meta.url)),
  paths: ["dist/**"],
});

const program = createDemoProgram({
  publishStep: "publish local site",
  publish: (workspace) => site.publish(workspace),
});
export const { lint, test, build, deploy } = program;

export const local: CI.RunConfiguration = { workspaceChanges: site.changes };

export default program.workflow;
