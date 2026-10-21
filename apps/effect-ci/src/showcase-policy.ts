import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import type { WorkerOptions } from "@effect-ci-testbed/github-cloudflare/worker";
import { ShowcaseSelection, ShowcaseRevision } from "./showcase-protocol.ts";

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
  if (selected.target === undefined && selected.targets === undefined) return undefined;
  if (selected.target !== undefined && selected.targets !== undefined) throw Error("Ambiguous showcase goals");
  return selected.targets ?? [selected.target!];
}

const routes = ["/showcase", "/showcase/", "/showcase/capabilities", "/showcase/runs",
  "/showcase/runs/:id", "/showcase/runs/:id/events"].map(pathname => new URLPattern({ pathname }));
export const showcaseRouteAllowed = (url: string) => routes.some(route => route.test(url));

/** Only two explicit owned showcase branches, never main/tutorial auto-CD. */
export const showcaseGitHubRun: NonNullable<WorkerOptions["githubRun"]> = (identity, _environment, context) => {
  if (!showcaseGitHubAllowed(identity)) return undefined;
  const workflow = (context?.exports as unknown as { ShowcaseCIWorkflow?: Workflow } | undefined)?.ShowcaseCIWorkflow;
  if (!workflow) throw Error("ShowcaseCIWorkflow is not exported");
  return { workflow };
};
