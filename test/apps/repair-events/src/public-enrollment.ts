import type { PublicIncidentEnrollment } from "../../../../packages/github/src/public-incident.ts";

// HOST SOURCE ONLY. Do not populate from a webhook, RPC payload, caller env or
// model. Exact merged-source deployment was independently read back while the
// public source remained unarmed. Arming is separate authenticated preparation.
export const publicIncidentEnrollment: PublicIncidentEnrollment | undefined = {
  policy: "owned-public-http-repair-v1",
  service: "effect-ci-repair-incident",
  source: "f8eb61a874ccf972fceed25ed6889978608d87bc",
  version: "9c829b54-985d-4811-b806-690f93338284",
  emission: "owned-public-health-500-v2",
  // Host-authored fixed error contains no token-looking identifier. Exact title,
  // private source proof, freshness and budget fences all remain required.
  message: "Effect CI public health check failed",
  fixtureDigest: "6e3a3627b9fd217104ff0b7d73aba6968d2422558539af3aac2f5f2625ef6dd6",
  notificationPolicy: "a376288b467440058fc2f3d8dd0f0e3b",
};
