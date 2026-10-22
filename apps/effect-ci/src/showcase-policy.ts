import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { detailsUrl, type WorkerOptions, type WorkerEnvironment } from "@effect-ci-testbed/github-cloudflare/worker";
import { ShowcaseSelection, ShowcaseRevision, ShowcaseRerun } from "./showcase-protocol.ts";

export const showcasePreviewRef = "refs/heads/demo/showcase-preview";
export const showcaseReleaseRef = "refs/heads/demo/showcase";
const Repository = Schema.Literals([
  "https://github.com/ericclemmons/effect-ci-testbed",
  "https://github.com/ericclemmons/effect-ci-testbed.git",
]);
const Source = Schema.Struct({ repository: Repository, revision: ShowcaseRevision });
const Push = Schema.Struct({
  repository: Repository,
  repositoryName: Schema.Literal("ericclemmons/effect-ci-testbed"),
  installationId: Schema.Literal(165265172),
  revision: ShowcaseRevision,
  ref: Schema.Literals([showcasePreviewRef, showcaseReleaseRef]),
});
export const showcaseRunAllowed = (input: unknown) => Option.isSome(Schema.decodeUnknownOption(Source)(input));
export const showcaseGitHubAllowed = (input: unknown) => Option.isSome(Schema.decodeUnknownOption(Push)(input));
export const showcaseProductionAllowed = (input: { trigger?: string; ref?: string }) =>
  input.trigger === "github" && input.ref === showcaseReleaseRef && showcaseGitHubAllowed(input);

export function showcaseSelection(input: unknown) {
  const selected = Schema.decodeUnknownSync(ShowcaseSelection)(input);
  const rerun = Schema.decodeUnknownSync(ShowcaseRerun)(input);
  if (rerun.rerunFrom !== undefined) {
    if (selected.target !== undefined && selected.targets !== undefined || selected.target === undefined && selected.targets === undefined)
      throw Error("Explicit compute rerun goals required");
    return ["build"] as const;
  }
  if (selected.target === undefined && selected.targets === undefined) return undefined;
  if (selected.target !== undefined && selected.targets !== undefined) throw Error("Ambiguous showcase goals");
  return selected.targets ?? [selected.target!];
}

const routes = ["/showcase", "/showcase/", "/showcase/capabilities", "/showcase/runs",
  "/showcase/executions", "/showcase/runs/:id", "/showcase/runs/:id/events"].map(pathname => new URLPattern({ pathname }));
export const showcaseRouteAllowed = (url: string) => routes.some(route => route.test(url));

/** The host's default template names product CI; the owned showcase is a
 * separate native Workflow. Preserve custom host templates and instance escaping. */
export const showcaseDetailsUrl = (environment: WorkerEnvironment, instanceId: string) =>
  detailsUrl(environment.EFFECT_CI_DETAILS_URL?.replace(
    "/workers/workflows/effect-ci-github-cloudflare/",
    "/workers/workflows/effect-ci-showcase/",
  ), instanceId);

/** Only two explicit owned showcase branches, never main/tutorial auto-CD. */
export const showcaseGitHubRun: NonNullable<WorkerOptions["githubRun"]> = (identity, environment, context) => {
  if (!showcaseGitHubAllowed(identity)) return undefined;
  const workflow = (context?.exports as unknown as { ShowcaseCIWorkflow?: Workflow } | undefined)?.ShowcaseCIWorkflow;
  if (!workflow) throw Error("ShowcaseCIWorkflow is not exported");
  const url = showcaseDetailsUrl(environment, identity.deliveryId);
  return { workflow, ...(url ? { detailsUrl: url } : {}) };
};

/** Showcase refs are started by their signed push delivery so moving one exact
 * commit from preview to release creates a distinct branch-owned attempt. */
export const showcaseCheckSuiteRun: NonNullable<WorkerOptions["githubRun"]> = (identity) =>
  showcaseGitHubAllowed(identity) ? false : undefined;
