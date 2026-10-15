import type { PublicIncidentEnrollment } from "../../../packages/github/src/public-incident.ts";

// HOST SOURCE ONLY. Do not populate from a webhook, RPC payload, caller env or
// model. Exact merged-source deployment was independently read back while the
// public source remained unarmed. Arming is separate authenticated preparation.
export const publicIncidentEnrollment: PublicIncidentEnrollment | undefined = {
  policy: "owned-public-http-repair-v1",
  service: "effect-ci-repair-incident",
  source: "23bdde6b7bd4924d13cb34666c484e3f6888e21b",
  version: "cd91c304-a8a1-48f5-97cf-ad60b7edb285",
  emission: "owned-public-health-500-v1",
  // Exact observed notification title after WOBS's token masking. This is a
  // literal display string, NOT a wildcard or source/occurrence attestation.
  message: "Effect CI owned public health fixture returned 500 (<token>)",
  fixtureDigest: "6e3a3627b9fd217104ff0b7d73aba6968d2422558539af3aac2f5f2625ef6dd6",
  notificationPolicy: "a376288b467440058fc2f3d8dd0f0e3b",
};
