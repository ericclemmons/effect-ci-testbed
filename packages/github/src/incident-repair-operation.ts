import { INCIDENT_IDENTITY, INCIDENT_ADMITTED_AT, INCIDENT_PROPOSAL_INSTANCE } from "./incident-proposal.ts";
import { INCIDENT_MODEL_RESERVATION, INCIDENT_MODEL_RUN, INCIDENT_MODEL_TEXT, type IncidentProposalEvidence } from "./incident-evidence.ts";
import { FIXED_SOURCE } from "./repair.ts";
import { OWNED_NODE_COMMAND } from "./repair-verifier.ts";
import type { OperationStore, RepairResult } from "./repair-operation.ts";

/** Separate HOST code policy; does not modify the admission's historic false flags. */
export const INCIDENT_REPAIR_POLICY = "host-owned-incident-proposed-pr-only-v1";
export const INCIDENT_REPAIR_RUN = "friday-owned-issue-e28e6b86-v1";
export const INCIDENT_REPAIR_OWNER = "owned-issue-e28e6b86-repair-v1";
export const INCIDENT_REPAIR_KEY = "owned-incident-repair-v1";
const reject = () => new Error("Owned incident repair rejected; inspect before recovery");
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw reject();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(k => typeof k !== "string" || !keys.includes(k))) throw reject();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !("value" in d)) throw reject();
    result[key] = d.value;
  }
  return result;
}
export function assertIncidentRepairEvidence(value: unknown): IncidentProposalEvidence {
  const expected: IncidentProposalEvidence = {
    instance: INCIDENT_PROPOSAL_INSTANCE, reservationId: INCIDENT_MODEL_RESERVATION,
    run: INCIDENT_MODEL_RUN, text: INCIDENT_MODEL_TEXT,
    issueId: INCIDENT_IDENTITY.issueId, operationId: INCIDENT_IDENTITY.operationId,
    activationPolicy: "host-owned-incident-proposal-only-v1",
  };
  const fields = exact(value, Object.keys(expected));
  for (const [key, item] of Object.entries(expected)) if (fields[key] !== item) throw reject();
  return expected;
}
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(value),
))].map(b => b.toString(16).padStart(2, "0")).join("");
export const incidentRepairDigest = () => hash(JSON.stringify([
  INCIDENT_REPAIR_POLICY, INCIDENT_REPAIR_OWNER, INCIDENT_REPAIR_KEY, INCIDENT_REPAIR_RUN,
  INCIDENT_IDENTITY, INCIDENT_ADMITTED_AT, OWNED_NODE_COMMAND, FIXED_SOURCE,
  INCIDENT_PROPOSAL_INSTANCE, INCIDENT_MODEL_RESERVATION, INCIDENT_MODEL_RUN, INCIDENT_MODEL_TEXT,
]));
async function result(value: unknown): Promise<RepairResult> {
  const v = exact(value, ["repository", "commit", "sourceDigest", "evidenceId", "pullRequest", "url", "created", "deploymentPerformed"]);
  if (v.repository !== INCIDENT_IDENTITY.repository || typeof v.commit !== "string" ||
      !/^[a-f0-9]{40}$/.test(v.commit) || v.sourceDigest !== await hash(FIXED_SOURCE) ||
      typeof v.evidenceId !== "string" || !/^github_check_[0-9]+$/.test(v.evidenceId) ||
      typeof v.pullRequest !== "number" || !Number.isSafeInteger(v.pullRequest) || v.pullRequest < 3 ||
      v.url !== `https://github.com/${INCIDENT_IDENTITY.repository}/pull/${v.pullRequest}` ||
      typeof v.created !== "boolean" || v.deploymentPerformed !== false) throw reject();
  return v as unknown as RepairResult;
}
export type IncidentRepairResult = RepairResult & {
  replay: boolean; issueId: string; operationId: string;
  modelInstance: string; modelReservationId: string;
  activationPolicy: typeof INCIDENT_REPAIR_POLICY;
  eventActivation: "authenticated-operator-continuation-of-admitted-issue";
  automaticWebhookActivation: false;
};
function wrap(value: RepairResult, replay: boolean): IncidentRepairResult {
  return { ...value, ...(replay ? { created: false } : {}), replay,
    issueId: INCIDENT_IDENTITY.issueId, operationId: INCIDENT_IDENTITY.operationId,
    modelInstance: INCIDENT_PROPOSAL_INSTANCE, modelReservationId: INCIDENT_MODEL_RESERVATION,
    activationPolicy: INCIDENT_REPAIR_POLICY,
    eventActivation: "authenticated-operator-continuation-of-admitted-issue", automaticWebhookActivation: false };
}
/** Trusted host closures ONLY. A matching arbitrary RPC object is NOT a capability.
 * Writer callback must enforce exact-commit native verification BEFORE PR creation.
 * Completed receipts are historical, never current approval or cache authority.
 */
export async function runIncidentRepair(store: OperationStore,
  readEvidence: () => Promise<unknown>,
  propose: (evidence: IncidentProposalEvidence) => Promise<RepairResult>,
): Promise<IncidentRepairResult> {
  const digest = await incidentRepairDigest();
  const existing = await store.read();
  if (existing !== undefined) {
    const record = exact(existing, ["version", "state", "digest", "result"]);
    if (record.version !== 1 || record.state !== "complete" || record.digest !== digest) throw reject();
    return wrap(await result(record.result), true);
  }
  const evidence = assertIncidentRepairEvidence(await readEvidence());
  if (!await store.claim({ version: 1, state: "pending", digest })) throw reject();
  try {
    const verified = await result(await propose(evidence));
    await store.complete(digest, verified); // Durable BEFORE acknowledgement.
    return wrap(verified, false);
  } catch {
    await store.fail(digest).catch(() => undefined);
    throw reject(); // No reset, fresh identity, automatic retry or recovery.
  }
}
