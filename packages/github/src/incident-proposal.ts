/** HOST-owned proposal-only activation policy. Not a signature, raw webhook parser,
 * GitHub write permission or proof that this module has executed native inference.
 */
export const INCIDENT_PROPOSAL_INSTANCE = "owned-issue-flue-e28e6b86-v1";
export const INCIDENT_PROPOSAL_INSPECT = "owned-issue-flue-e28e6b86-inspect-v1";
export const INCIDENT_ADMITTED_AT = 1791992186246;
export const INCIDENT_IDENTITY = Object.freeze({
  version: 1,
  policyVersion: "friday-owned-incident-enrollment-v1",
  issueId: "e28e6b86-bea4-440f-8729-be6437e97293",
  occurrenceId: "01M4XA9MBZ0000000000000009",
  producerSource: "ff1a3497552d6e165b2407ab165d98f684ea84d2",
  producerVersion: "20a3b050-574b-40fc-bf22-5d4086926484",
  repository: "ericclemmons/effect-ci-private-github-fixture",
  base: "352327387f610d84282a567bf9a40ceee3978950",
  path: "repair-demo/health.js",
  operationId: "owned-issue:e28e6b86-bea4-440f-8729-be6437e97293",
  sourceMapping: "developer-enrolled-owned-fixture",
  inferenceTriggered: false,
  repairAuthorized: false,
});
const rejected = () => new Error("Owned incident proposal activation rejected");
function exactFields(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw rejected();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((k) => typeof k !== "string" || !keys.includes(k))
  )
    throw rejected();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw rejected();
    result[key] = descriptor.value;
  }
  return result;
}
/** Only trusted host service-binding results enter here, never actor/RPC parameters. */
export function assertAdmittedIncident(receipt: unknown) {
  const top = exactFields(receipt, ["state", "identity", "admittedAt"]);
  if (top.state !== "admitted" || top.admittedAt !== INCIDENT_ADMITTED_AT)
    throw rejected();
  const identity = exactFields(top.identity, Object.keys(INCIDENT_IDENTITY));
  for (const [key, value] of Object.entries(INCIDENT_IDENTITY))
    if (identity[key] !== value) throw rejected();
  // Preserve the receipt's false flags. A separate HOST code policy authorizes
  // proposal-only execution; no caller can turn admission into repair permission.
  return {
    identity: { ...INCIDENT_IDENTITY },
    admittedAt: INCIDENT_ADMITTED_AT,
    activationPolicy: "host-owned-incident-proposal-only-v1" as const,
    instance: INCIDENT_PROPOSAL_INSTANCE,
    run: "friday-flue-proposal-v1" as const,
  };
}
export function incidentProposalMode(
  instance: string,
  input: unknown,
): "inspect" | "proposal" {
  const { mode } = exactFields(input, ["mode"]);
  if (mode === "inspect" && instance === INCIDENT_PROPOSAL_INSPECT) return mode;
  if (mode === "proposal" && instance === INCIDENT_PROPOSAL_INSTANCE)
    return mode;
  throw rejected();
}
