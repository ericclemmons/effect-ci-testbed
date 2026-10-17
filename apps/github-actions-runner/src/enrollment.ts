import type { Enrollment } from "./policy.ts";

// Host-owned policy, NOT webhook input. Reuse the existing Effect CI App;
// installation tokens are still reduced to this one trusted private repository.
export const enrollment: Enrollment = {
  enabled: true,
  appId: 5089816,
  installationId: 165265172,
  repositoryId: 1416063432,
  repository: "ericclemmons/effect-ci-private-github-fixture",
  runnerGroupId: 1,
  lifetimeSeconds: 900,
};
