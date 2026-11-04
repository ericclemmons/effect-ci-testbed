import type { PublicIncidentEnrollment } from "../../../../packages/github/src/public-incident.ts";

// HOST SOURCE ONLY. Work-account source/version and notification policy were
// independently read back after bootstrap. Durable arming is a separate step.
export const publicIncidentEnrollment: PublicIncidentEnrollment | undefined = {
  policy: "owned-public-http-repair-v1",
  service: "effect-ci-repair-incident",
  source: "600a0e6b2d1cdc5c3046e0cb606d1ad012acfdef",
  version: "b0ef08f6-7f42-4928-b35d-da5d0d770c0e",
  emission: "owned-public-health-500-v2",
  message: "Effect CI public health check failed",
  fixtureDigest: "6e3a3627b9fd217104ff0b7d73aba6968d2422558539af3aac2f5f2625ef6dd6",
  notificationPolicy: "f1f5f1a16aea488999a43099cc75ed03",
};
