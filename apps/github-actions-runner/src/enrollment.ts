import type { Enrollment } from "./policy.ts";

// Host-owned policy, NOT webhook input. A separate, selected-repository GitHub
// App is required. Do not expand the existing Effect CI App's permissions.
export const enrollment: Enrollment = {
  enabled: false,
  appId: 0,
  installationId: 0,
  repositoryId: 0,
  repository: "owner/private-repository",
  runnerGroupId: 1,
  lifetimeSeconds: 900,
};
