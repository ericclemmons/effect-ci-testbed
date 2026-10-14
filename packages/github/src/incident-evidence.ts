import {
  assertAdmittedIncident,
  INCIDENT_PROPOSAL_INSTANCE,
} from "./incident-proposal.ts";
export const INCIDENT_MODEL_RESERVATION =
  "flue_54c540e5b12e62cae83001008487f8a26b1652a7664fb511a576e045f8e47c87";
export const INCIDENT_MODEL_RUN = "friday-flue-proposal-v1";
export const INCIDENT_MODEL_TEXT =
  "export function healthStatus() { return 200; }";
export const INCIDENT_SUBMISSION = "sub_01M4XPE50F29A6YN5MSJR8BYXF";
export const INCIDENT_AGENT_UID = "inst_01M4XPE5GBG53NGQX4BSAK9V62";
export type IncidentProposalEvidence = {
  instance: string;
  reservationId: string;
  run: string;
  text: string;
  issueId: string;
  operationId: string;
  activationPolicy: "host-owned-incident-proposal-only-v1";
};
const reject = () => new Error("Native incident proposal evidence rejected");
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw reject();
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d || !("value" in d)) throw reject();
  return d.value;
}
function ledger(value: unknown, minimum: number) {
  if (field(value, "budget") !== "friday-demo-repair-2-usd-v1") throw reject();
  const entries = field(value, "reservations");
  if (
    !Array.isArray(entries) ||
    entries.length < minimum ||
    entries.length > 70
  )
    throw reject();
  const reserved = field(value, "reservedCents"),
    remaining = field(value, "remainingCents");
  if (
    reserved !== entries.length * 10 ||
    typeof remaining !== "number" ||
    remaining < 0 ||
    remaining + Number(reserved) !== 700
  )
    throw reject();
  const ids = new Map<string, string>();
  for (let i = 0; i < entries.length; i++) {
    const d = Object.getOwnPropertyDescriptor(entries, String(i));
    if (!d || !("value" in d)) throw reject();
    const id = field(d.value, "id"),
      run = field(d.value, "run");
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,96}$/.test(id) ||
      typeof run !== "string" ||
      !/^[a-zA-Z0-9_-]{1,96}$/.test(run) ||
      ids.has(id)
    )
      throw reject();
    ids.set(id, run);
  }
  return ids;
}
/** Completed OWN native Workflow output + independent broker status, never model assertions.
 * Workflow.status() does not expose per-step attempts; the separate read-only
 * native regression verifies all FIVE actual checkpoint histories.
 */
export function incidentProposalFromHistory(
  history: unknown,
  currentLedger: unknown,
): IncidentProposalEvidence {
  if (field(history, "status") !== "complete") throw reject();
  const output = field(history, "output"),
    admitted = field(output, "admitted");
  const activation = assertAdmittedIncident({
    state: "admitted",
    identity: field(admitted, "identity"),
    admittedAt: field(admitted, "admittedAt"),
  });
  if (
    field(admitted, "activationPolicy") !== activation.activationPolicy ||
    field(admitted, "instance") !== INCIDENT_PROPOSAL_INSTANCE ||
    field(admitted, "run") !== INCIDENT_MODEL_RUN ||
    field(output, "repairVerified") !== false ||
    field(output, "githubWritePerformed") !== false ||
    field(output, "eventActivation") !==
      "authenticated-operator-continuation-of-admitted-issue"
  )
    throw reject();
  const proposal = field(output, "proposal"),
    receipt = field(proposal, "receipt");
  if (
    field(proposal, "text") !== INCIDENT_MODEL_TEXT ||
    field(proposal, "reservationId") !== INCIDENT_MODEL_RESERVATION ||
    field(proposal, "proposalOnly") !== true ||
    field(proposal, "repairVerified") !== false ||
    field(receipt, "submissionId") !== INCIDENT_SUBMISSION ||
    field(receipt, "uid") !== INCIDENT_AGENT_UID ||
    field(receipt, "acceptedAt") !== "2026-10-14T17:12:53.519Z"
  )
    throw reject();
  const beforeValue = field(proposal, "before"),
    afterValue = field(proposal, "after");
  const before = ledger(beforeValue, 4),
    after = ledger(afterValue, 5),
    current = ledger(currentLedger, 5);
  if (
    before.size !== 4 ||
    after.size !== 5 ||
    field(beforeValue, "reservedCents") !== 40 ||
    field(afterValue, "reservedCents") !== 50 ||
    before.has(INCIDENT_MODEL_RESERVATION) ||
    after.get(INCIDENT_MODEL_RESERVATION) !== INCIDENT_MODEL_RUN ||
    current.get(INCIDENT_MODEL_RESERVATION) !== INCIDENT_MODEL_RUN
  )
    throw reject();
  const old = new Map([
    ["probe_coverage-repair-budget-proposal-20261013-1", "native-budget-probe"],
    ["probe_coverage-repair-budget-stream-20261013-1", "native-budget-probe"],
    ["probe_coverage-repair-recovery-stream-20261014-1", "native-budget-probe"],
    [
      "flue_9215338e5c51bb55f8926ef9bcfb3186f4e970f83639929024685ab2ce2df43e",
      INCIDENT_MODEL_RUN,
    ],
  ]);
  for (const [id, run] of old)
    if (
      before.get(id) !== run ||
      after.get(id) !== run ||
      current.get(id) !== run
    )
      throw reject();
  return {
    instance: INCIDENT_PROPOSAL_INSTANCE,
    reservationId: INCIDENT_MODEL_RESERVATION,
    run: INCIDENT_MODEL_RUN,
    text: INCIDENT_MODEL_TEXT,
    issueId: activation.identity.issueId,
    operationId: activation.identity.operationId,
    activationPolicy: activation.activationPolicy,
  };
}
