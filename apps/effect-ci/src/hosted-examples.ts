import * as CI from "@effect-ci-testbed/ci";
import { additionalRunId, detailsUrl, type WorkerEnvironment, type WorkerOptions, type WorkflowParameters } from "@effect-ci-testbed/github-cloudflare/worker";
import exportedActions from "../../../examples/exported-actions/.cloudflare/ci/workflow.ts";
import matrix from "../../../examples/matrix/.cloudflare/ci/workflow.ts";
import nodeNpm from "../../../examples/node-npm/.cloudflare/ci/workflow.ts";
import nodePnpm from "../../../examples/node-pnpm/.cloudflare/ci/workflow.ts";
import optionalChecks from "../../../examples/optional-checks/.cloudflare/ci/workflow.ts";
import testSplitting from "../../../examples/test-splitting/.cloudflare/ci/workflow.ts";
import timingAwareSplitting from "../../../examples/timing-aware-splitting/.cloudflare/ci/workflow.ts";
import zeroConfigManifest from "../../../examples/zero-config/package.json" with { type: "json" };
import demoManifest from "../../../test/fixtures/demo/package.json" with { type: "json" };
import { monorepoAllowed } from "./monorepo-policy.ts";

export interface HostedExample {
  /** The `examples/<recipe>` directory. The workflow ID must match so the
   * summary check is `Cloudflare / <recipe>`, the docs' Cloudflare cell. */
  readonly recipe: string;
  /** Project directory when it is not `examples/<recipe>`. */
  readonly root?: string;
  readonly workflow: CI.Workflow<unknown>;
}

// Zero-config discovery normally reads package.json in the project. The host
// never reads repository files, so it builds the same actions from the
// committed manifest and selects every script, like the effect-on-github job.
const zeroConfig = CI.fromPackageJson(zeroConfigManifest);
const zeroConfigWorkflow = CI.workflow("zero-config", () =>
  CI.parallel(Object.keys(zeroConfigManifest.scripts).map(name => zeroConfig.actions[name]!())));

// The demo row runs the walkthrough project in test/fixtures/demo, discovered
// the same way and with the same goals as its local and effect-on-github runs.
const demo = CI.fromPackageJson(demoManifest);
const demoWorkflow = CI.workflow("demo", () =>
  CI.parallel(["lint", "check", "typecheck", "test", "build"].map(name => demo.actions[name]!())));

/** Example workflows the owned App runs beside `monorepo` for each check suite.
 * Walkthrough order. Add a recipe here only after it runs locally from its own
 * directory without credentials, deployment or Docker. */
export const hostedExamples: ReadonlyArray<HostedExample> = [
  { recipe: "node-npm", workflow: nodeNpm },
  { recipe: "node-pnpm", workflow: nodePnpm },
  { recipe: "zero-config", workflow: zeroConfigWorkflow },
  { recipe: "exported-actions", workflow: exportedActions },
  { recipe: "demo", root: "test/fixtures/demo", workflow: demoWorkflow },
  { recipe: "optional-checks", workflow: optionalChecks },
  { recipe: "matrix", workflow: matrix },
  { recipe: "test-splitting", workflow: testSplitting },
  { recipe: "timing-aware-splitting", workflow: timingAwareSplitting },
];

export const projectRoot = (example: HostedExample) => example.root ?? `examples/${example.recipe}`;

export const selectedExample = (parameters: WorkflowParameters): HostedExample | undefined =>
  parameters.trigger === "github" && monorepoAllowed(parameters)
    ? hostedExamples.find(example => projectRoot(example) === parameters.project?.root) : undefined;

/** The host template names product CI; examples are a separate native Workflow. */
export const exampleDetailsUrl = (environment: WorkerEnvironment, instanceId: string) =>
  detailsUrl(environment.EFFECT_CI_DETAILS_URL?.replace(
    "/workers/workflows/effect-ci-github-cloudflare/",
    "/workers/workflows/effect-ci-examples/",
  ), instanceId);

/** Same source policy as the monorepo run: this repository, App installation and a branch. */
export const hostedExampleRuns: NonNullable<WorkerOptions["githubCheckSuiteRuns"]> = (identity, environment, context) => {
  if (!monorepoAllowed(identity)) return [];
  const workflow = (context?.exports as unknown as { ExampleCIWorkflow?: Workflow } | undefined)?.ExampleCIWorkflow;
  if (!workflow) throw Error("ExampleCIWorkflow is not exported");
  return hostedExamples.map(example => {
    const { recipe } = example;
    const url = exampleDetailsUrl(environment, additionalRunId(identity.deliveryId, recipe));
    return { key: recipe, workflow, checkName: `Cloudflare / ${recipe}`, project: { root: projectRoot(example) },
      ...(url ? { detailsUrl: url } : {}) };
  });
};
