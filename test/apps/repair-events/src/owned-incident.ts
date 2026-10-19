/** Developer enrollment from independently retained Issue + occurrence API evidence.
 * The webhook does NOT supply scriptVersion or the private repository base.
 * This deliberately bounded pilot enrolls ONE existing owned incident, not all Issues.
 */
export const OWNED_INCIDENT = Object.freeze({
  policyVersion: "friday-owned-incident-enrollment-v1",
  issueId: "e28e6b86-bea4-440f-8729-be6437e97293",
  occurrenceId: "01M4XA9MBZ0000000000000009",
  correlationId: "aad8650d-a770-4815-adfb-f335c2ce5da6",
  notificationPolicyId: "a376288b467440058fc2f3d8dd0f0e3b",
  automationId: "0d9ff5e2-b362-46bd-a33d-4640b46e18cc",
  service: "effect-ci-repair-incident",
  producerSource: "ff1a3497552d6e165b2407ab165d98f684ea84d2",
  producerVersion: "20a3b050-574b-40fc-bf22-5d4086926484",
  fingerprint: "bfe6d5c7044a36c4fc37a58d2f961ff5",
  firstObserved: "2026-10-14T13:40:42.495Z",
  repository: "ericclemmons/effect-ci-private-github-fixture",
  base: "352327387f610d84282a567bf9a40ceee3978950",
  path: "repair-demo/health.js",
  captureDigest:
    "090b9a8ca33d048025f301270f0eb48d27a44ec2931306382d7de51fac5f9a58",
});
export type OwnedIncident = {
  version: 1;
  policyVersion: string;
  issueId: string;
  occurrenceId: string;
  producerSource: string;
  producerVersion: string;
  repository: string;
  base: string;
  path: string;
  operationId: string;
  sourceMapping: "developer-enrolled-owned-fixture";
  inferenceTriggered: false;
  repairAuthorized: false;
};
const rejected = () => new Error("Owned incident admission rejected");
export function normalizeOwnedIncident(raw: unknown): OwnedIncident {
  if (
    typeof raw !== "string" ||
    new TextEncoder().encode(raw).byteLength > 32 * 1024
  )
    throw rejected();
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    throw rejected();
  }
  const owned = OWNED_INCIDENT;
  const issue = event?.data?.issue;
  const services = issue?.services;
  if (
    !event ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    event.alert_type !== "workers_observability_real_time_issue" ||
    event.policy_id !== owned.notificationPolicyId ||
    event.alert_event !== "ALERT_STATE_EVENT_START" ||
    event.alert_correlation_id !== owned.correlationId ||
    event.data?.state_event !== "ALERT_STATE_EVENT_START" ||
    event.data?.state_correlation_id !== owned.correlationId ||
    issue?.id !== owned.issueId ||
    issue?.fingerprint !== owned.fingerprint ||
    issue?.count !== "1" ||
    issue?.first_observed !== owned.firstObserved ||
    issue?.last_observed !== owned.firstObserved ||
    issue?.type !== "ISSUE_TYPE_LOG" ||
    issue?.status !== "ISSUE_STATUS_ACTIVE" ||
    !Array.isArray(services) ||
    services.length !== 1 ||
    services[0]?.name !== owned.service ||
    services[0]?.type !== "SERVICE_TYPE_WORKER" ||
    services[0]?.first_observed !== owned.firstObserved ||
    services[0]?.last_observed !== owned.firstObserved
  )
    throw rejected();
  // No title/text/context/model/prompt/repo/version from the payload is returned.
  return ownedIncidentIdentity();
}
export function ownedIncidentIdentity(): OwnedIncident {
  const p = OWNED_INCIDENT;
  return {
    version: 1,
    policyVersion: p.policyVersion,
    issueId: p.issueId,
    occurrenceId: p.occurrenceId,
    producerSource: p.producerSource,
    producerVersion: p.producerVersion,
    repository: p.repository,
    base: p.base,
    path: p.path,
    operationId: `owned-issue:${p.issueId}`,
    sourceMapping: "developer-enrolled-owned-fixture",
    inferenceTriggered: false,
    repairAuthorized: false,
  };
}
export function ownedAdmissionMode(
  input: unknown,
): "inspect" | "admit-retained" {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw rejected();
  const keys = Reflect.ownKeys(input);
  const mode = Object.getOwnPropertyDescriptor(input, "mode");
  if (
    keys.length !== 1 ||
    keys[0] !== "mode" ||
    !mode ||
    !("value" in mode) ||
    (mode.value !== "inspect" && mode.value !== "admit-retained")
  )
    throw rejected();
  return mode.value;
}
