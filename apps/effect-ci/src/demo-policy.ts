import type { WorkerOptions, WorkflowParameters } from "@effect-ci-testbed/github-cloudflare/worker";

/** Host enrollment, not an incoming repository/module selector. */
export const demoGitHubRef = "refs/heads/main";
export const demoRemoteTargets = Object.freeze(["lint", "check", "typecheck", "test", "build"] as const);
export function demoRemoteSelection(input: { readonly target?: unknown; readonly targets?: unknown }) {
  if (input.target === undefined && input.targets === undefined) return undefined;
  if (input.target !== undefined && input.targets !== undefined) throw Error("Invalid demo goal selection");
  const values = input.targets === undefined ? [input.target] : input.targets;
  if (!Array.isArray(values) || !values.length || values.length > demoRemoteTargets.length ||
    new Set(values).size !== values.length || values.some(value => !demoRemoteTargets.includes(value)))
    throw Error("Unenrolled demo goal selection");
  return Object.freeze([...values]) as ReadonlyArray<typeof demoRemoteTargets[number]>;
}
export const demoGitHubAllowed = (input: {
  readonly repository: string; readonly repositoryName: string; readonly revision: string;
  readonly installationId: number; readonly ref?: string;
  readonly target?: string; readonly targets?: ReadonlyArray<string>;
}): boolean => input.target === undefined && input.targets === undefined && demoRunAllowed(input) && input.repositoryName === "ericclemmons/effect-ci-testbed" &&
  input.installationId === 165265172 && typeof input.ref === "string" &&
  input.ref.startsWith("refs/heads/") && input.ref.length > "refs/heads/".length &&
  input.ref.length <= 1024 && !/[\x00-\x20\x7f]/.test(input.ref);

/** The App can be installed broadly; this hosted program is enrolled separately. */
export const demoGitHubRun: NonNullable<WorkerOptions["githubRun"]> = (identity, _environment, context) => {
  if (!demoGitHubAllowed(identity)) return false;
  const workflow = (context?.exports as unknown as { DemoCIWorkflow?: Workflow<WorkflowParameters> } | undefined)?.DemoCIWorkflow;
  if (!workflow) throw Error("DemoCIWorkflow is not exported");
  return { workflow, detailsUrl: `https://dash.cloudflare.com/0db135ec469e2f216fcea26426f29755/workers/workflows/effect-ci-demo/instance/${encodeURIComponent(identity.deliveryId)}` };
};

/** Only canonical authenticated main runs can obtain release authority. */
export const demoProductionAllowed = (input: Parameters<typeof demoGitHubAllowed>[0]): boolean =>
  demoGitHubAllowed(input) && input.ref === demoGitHubRef;

export const demoRouteAllowed = (pathname: string): boolean =>
  pathname === "/demo" ||
  pathname === "/demo/" ||
  pathname === "/demo/capabilities" ||
  pathname === "/demo/runs" ||
  /^\/demo\/runs\/[A-Za-z0-9_-]+(?:\/events)?$/.test(pathname);

export const demoRunAllowed = (input: {
  readonly repository: string;
  readonly revision: string;
  readonly target?: string;
  readonly targets?: ReadonlyArray<string>;
}): boolean => {
  if (![
    "https://github.com/ericclemmons/effect-ci-testbed.git",
    "https://github.com/ericclemmons/effect-ci-testbed",
  ].includes(input.repository) || !/^[0-9a-f]{40}$/.test(input.revision)) return false;
  try { demoRemoteSelection(input); return true; } catch { return false; }
};
