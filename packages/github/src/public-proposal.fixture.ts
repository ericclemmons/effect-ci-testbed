/** Synthetic LOCAL test data, never a native admission, ledger or model receipt. */
import { publicIncidentIdentity } from "./public-incident.ts";
import { PUBLIC_REPAIR_POLICY, PUBLIC_FIXTURE_DIGEST, PUBLIC_MODEL_RUN, PUBLIC_REQUIRED_RESERVATIONS } from "./public-proposal.ts";
export async function publicProposalFixture() {
  const at = Date.now() - 1000;
  const admitted = await publicIncidentIdentity({ policy: PUBLIC_REPAIR_POLICY,
    issue: "33333333-3333-3333-3333-333333333333", correlation: "22222222-2222-2222-2222-222222222222",
    service: "effect-ci-repair-incident", source: "a".repeat(40), version: "11111111-1111-1111-1111-111111111111",
    emission: "owned-public-health-500-v1", fixtureDigest: PUBLIC_FIXTURE_DIGEST, claimedAt: at, observedAt: at + 1 });
  const before = { budget: "friday-demo-repair-2-usd-v1", reservedCents: 50, remainingCents: 650,
    reservations: PUBLIC_REQUIRED_RESERVATIONS.map(([id, run]) => ({ id, run })) };
  const reservationId = "flue_" + "d".repeat(64);
  const after = { ...before, reservedCents: 60, remainingCents: 640,
    reservations: [...before.reservations, { id: reservationId, run: PUBLIC_MODEL_RUN }] };
  const view = { instance: admitted.instance, admission: admitted.admission };
  const output = { admitted: view, activationPolicy: PUBLIC_REPAIR_POLICY, githubWritePerformed: false, repairVerified: false,
    proposal: { before, after, reservationId, text: "export function healthStatus() { return 200; }",
      proposalOnly: true, repairVerified: false,
      receipt: { submissionId: "sub_LOCAL", uid: "inst_LOCAL", acceptedAt: new Date().toISOString() } } };
  return { view, before, after, output, reservationId };
}
