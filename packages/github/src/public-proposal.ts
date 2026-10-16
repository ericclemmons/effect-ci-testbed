import { publicIncidentIdentity, type PublicIncidentAdmission } from "./public-incident.ts";
import { INCIDENT_MODEL_RESERVATION } from "./incident-evidence.ts";
import { repairSource } from "./repair.ts";

export const PUBLIC_REPAIR_POLICY = "owned-public-http-repair-v1";
export const PUBLIC_MODEL_RUN = "friday-flue-proposal-v1";
export const PUBLIC_FIXTURE_DIGEST = "6e3a3627b9fd217104ff0b7d73aba6968d2422558539af3aac2f5f2625ef6dd6";
export const PUBLIC_REQUIRED_RESERVATIONS = Object.freeze([
  ["probe_coverage-repair-budget-proposal-20261013-1", "native-budget-probe"],
  ["probe_coverage-repair-budget-stream-20261013-1", "native-budget-probe"],
  ["probe_coverage-repair-recovery-stream-20261014-1", "native-budget-probe"],
  ["flue_9215338e5c51bb55f8926ef9bcfb3186f4e970f83639929024685ab2ce2df43e", PUBLIC_MODEL_RUN],
  [INCIDENT_MODEL_RESERVATION, PUBLIC_MODEL_RUN],
] as const);
const rejected = () => new Error("Public proposal evidence rejected; reconcile the SAME model slot before recovery");
export function publicProposalMode(instance: string, value: unknown) {
  if (!/^public-incident-[a-f0-9]{64}$/.test(instance) || !value || typeof value !== "object" ||
      Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== 1) throw rejected();
  const mode = Object.getOwnPropertyDescriptor(value, "mode");
  if (!mode || !("value" in mode) || mode.value !== "proposal") throw rejected();
}
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw rejected();
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d || !("value" in d)) throw rejected();
  return d.value;
}

/** A trusted PRIVATE admission service is the authority, not a matching object
 * supplied by an event. Worker hosts copy RPC fields before using this schema.
 */
export async function assertPublicAdmission(instance: string, value: unknown) {
  const admission = field(value, "admission") as PublicIncidentAdmission;
  const identity = await publicIncidentIdentity(admission);
  if (field(value, "instance") !== instance || identity.instance !== instance ||
      identity.admission.policy !== PUBLIC_REPAIR_POLICY ||
      identity.admission.service !== "effect-ci-repair-incident" ||
      !["owned-public-health-500-v1", "owned-public-health-500-v2"].includes(identity.admission.emission) ||
      identity.admission.fixtureDigest !== PUBLIC_FIXTURE_DIGEST) throw rejected();
  return { instance, admission: identity.admission };
}
/** Preserve the existing lifetime ledger AND historical reservations. This
 * explicitly rejects an empty/reset/renamed/new pool before inference.
 */
export function publicBudget(value: unknown, beforeInference = false) {
  if (field(value, "budget") !== "friday-demo-repair-2-usd-v1") throw rejected();
  const entries = field(value, "reservations");
  if (!Array.isArray(entries) || entries.length < 5 || entries.length > 70 ||
      field(value, "reservedCents") !== entries.length * 10 ||
      field(value, "remainingCents") !== 700 - entries.length * 10) throw rejected();
  const ids = new Map<string, string>();
  for (let i = 0; i < entries.length; i++) {
    const d = Object.getOwnPropertyDescriptor(entries, String(i));
    if (!d || !("value" in d)) throw rejected();
    const id = field(d.value, "id"), run = field(d.value, "run");
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(id) || ids.has(id) ||
        typeof run !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(run)) throw rejected();
    ids.set(id, run);
  }
  for (const [id, run] of PUBLIC_REQUIRED_RESERVATIONS) if (ids.get(id) !== run) throw rejected();
  const hostCalls = [...ids.values()].filter(run => run === PUBLIC_MODEL_RUN).length;
  if (hostCalls > 4 || (beforeInference && (hostCalls >= 4 || ids.size >= 70))) throw rejected();
  return ids;
}
export interface PublicProposalEvidence {
  instance: string;
  admission: PublicIncidentAdmission;
  run: typeof PUBLIC_MODEL_RUN;
  reservationId: string;
  text: string;
  submissionId: string;
  agentUid: string;
  acceptedAt: string;
}
/** Fresh OWN completed Workflow output + independent current broker ledger.
 * No hardcoded old model response/reservation/submission can stand in for a new
 * call. Canonical proposal grammar remains the fixed one-function repair.
 */
export async function publicProposalFromHistory(
  instance: string, history: unknown, expectedAdmission: unknown, currentLedger: unknown,
): Promise<PublicProposalEvidence> {
  if (field(history, "status") !== "complete") throw rejected();
  const expected = await assertPublicAdmission(instance, expectedAdmission);
  const output = field(history, "output");
  const actual = await assertPublicAdmission(instance, field(output, "admitted"));
  if (JSON.stringify(actual) !== JSON.stringify(expected) ||
      field(output, "activationPolicy") !== PUBLIC_REPAIR_POLICY ||
      field(output, "githubWritePerformed") !== false || field(output, "repairVerified") !== false)
    throw rejected();
  const proposal = field(output, "proposal");
  const before = publicBudget(field(proposal, "before"), true);
  const after = publicBudget(field(proposal, "after"));
  const current = publicBudget(currentLedger);
  const reservationId = field(proposal, "reservationId");
  if (typeof reservationId !== "string" || !/^flue_[a-f0-9]{64}$/.test(reservationId) ||
      before.has(reservationId) || after.get(reservationId) !== PUBLIC_MODEL_RUN ||
      current.get(reservationId) !== PUBLIC_MODEL_RUN || after.size !== before.size + 1 ||
      field(proposal, "proposalOnly") !== true || field(proposal, "repairVerified") !== false)
    throw rejected();
  for (const [id, run] of before) if (after.get(id) !== run || current.get(id) !== run) throw rejected();
  const text = field(proposal, "text");
  repairSource(text); // Validate, never execute the model reply.
  const receipt = field(proposal, "receipt");
  const submissionId = field(receipt, "submissionId"), agentUid = field(receipt, "uid"), acceptedAt = field(receipt, "acceptedAt");
  if (typeof submissionId !== "string" || !/^sub_[a-zA-Z0-9_-]{1,100}$/.test(submissionId) ||
      typeof agentUid !== "string" || !/^inst_[a-zA-Z0-9_-]{1,100}$/.test(agentUid) ||
      typeof acceptedAt !== "string" || !Number.isFinite(Date.parse(acceptedAt)) ||
      Date.parse(acceptedAt) < expected.admission.observedAt) throw rejected();
  return { ...expected, run: PUBLIC_MODEL_RUN, reservationId, text: text as string,
    submissionId, agentUid, acceptedAt };
}
