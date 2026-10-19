import type { WorkerOptions } from "@effect-ci-testbed/github-cloudflare/worker";

export const monorepoAllowed = (input: {
  repository: string; repositoryName: string; revision: string; installationId: number; ref?: string;
}) => ["https://github.com/ericclemmons/effect-ci-testbed", "https://github.com/ericclemmons/effect-ci-testbed.git"].includes(input.repository) &&
  input.repositoryName === "ericclemmons/effect-ci-testbed" && input.installationId === 165265172 &&
  /^[a-f0-9]{40}$/.test(input.revision) && (input.ref?.length ?? 0) <= 1024 && /^refs\/heads\/[\w./-]+$/.test(input.ref ?? "");

export const monorepoGitHubRun: NonNullable<WorkerOptions["githubRun"]> = (identity, _env, context) => {
  if (!monorepoAllowed(identity)) return false;
  const workflow = (context?.exports as unknown as { EffectCIWorkflow?: Workflow } | undefined)?.EffectCIWorkflow;
  if (!workflow) throw Error("EffectCIWorkflow is not exported");
  return { workflow };
};
