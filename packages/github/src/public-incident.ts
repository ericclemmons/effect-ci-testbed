/** HOST-owned protocol for ONE new public HTTP incident. Authentication of a
 * notification alone is insufficient: the host must obtain a separate private
 * producer receipt and pin its deployed version/source before calling this seam.
 * Neither this module nor an event supplies a Cloudflare/GitHub credential.
 */
export interface PublicIncidentEnrollment {
  policy: string;
  service: string;
  source: string;
  version: string;
  emission: string;
  message: string;
  fixtureDigest: string;
  notificationPolicy: string;
}
export interface PublicIncidentAdmission {
  policy: string;
  issue: string;
  correlation: string;
  service: string;
  source: string;
  version: string;
  emission: string;
  fixtureDigest: string;
  claimedAt: number;
  observedAt: number;
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const sha = (v: unknown, size: number): v is string =>
  typeof v === "string" && new RegExp(`^[a-f0-9]{${size}}$`).test(v);
const identifier = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(v);
const rejected = () => new Error("Public incident activation rejected; inspect the SAME outbox before recovery");
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw rejected();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(k => typeof k !== "string" || !keys.includes(k))) throw rejected();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !("value" in d)) throw rejected();
    result[key] = d.value;
  }
  return result;
}
function enrollment(value: PublicIncidentEnrollment) {
  const p = exact(value, ["policy", "service", "source", "version", "emission", "message", "fixtureDigest", "notificationPolicy"]);
  if (!identifier(p.policy) || !identifier(p.service) || !sha(p.source, 40) || !uuid(p.version) ||
      !identifier(p.emission) || !sha(p.fixtureDigest, 64) || !sha(p.notificationPolicy, 32) ||
      typeof p.message !== "string" || p.message.length < 1 || p.message.length > 256 ||
      /[\x00-\x1f\x7f]/.test(p.message)) throw rejected();
  return p as unknown as PublicIncidentEnrollment;
}
/** raw MUST come from the authenticated, immutable receiver capture. producer
 * MUST come from a HOST-selected private service binding, never request fields.
 * This is developer enrollment/corroboration, not occurrence-API attestation.
 * Any later native evidence must describe that distinction honestly.
 */
export function admitPublicIncident(
  raw: unknown,
  producer: unknown,
  trustedEnrollment: PublicIncidentEnrollment,
  now: number,
): PublicIncidentAdmission {
  const p = enrollment(trustedEnrollment);
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 32768 ||
      !Number.isSafeInteger(now) || now < 0) throw rejected();
  const receipt = exact(producer, ["emission", "version", "currentVersion", "fixtureDigest", "claimedAt"]);
  if (receipt.emission !== p.emission || receipt.version !== p.version ||
      receipt.currentVersion !== p.version || receipt.fixtureDigest !== p.fixtureDigest ||
      typeof receipt.claimedAt !== "number" || !Number.isSafeInteger(receipt.claimedAt) ||
      receipt.claimedAt < 0 || receipt.claimedAt > now || now - receipt.claimedAt > 5 * 60_000) throw rejected();
  let event;
  try { event = JSON.parse(raw); } catch { throw rejected(); }
  const issue = event?.data?.issue;
  const observedAt = typeof issue?.first_observed === "string" ? Date.parse(issue.first_observed) : NaN;
  const services = issue?.services;
  if (event?.alert_type !== "workers_observability_real_time_issue" ||
      event.policy_id !== p.notificationPolicy || event.alert_event !== "ALERT_STATE_EVENT_START" ||
      event.data?.state_event !== "ALERT_STATE_EVENT_START" || !uuid(event.alert_correlation_id) ||
      event.alert_correlation_id !== event.data.state_correlation_id || !uuid(issue?.id) ||
      issue.count !== "1" || issue.type !== "ISSUE_TYPE_EXCEPTION" || issue.status !== "ISSUE_STATUS_ACTIVE" ||
      typeof issue.title !== "string" || issue.title.length > 1024 ||
      ![p.message, `Error: ${p.message}`].includes(issue.title.split(" · at ")[0]) ||
      !Number.isFinite(observedAt) || observedAt < receipt.claimedAt ||
      observedAt - receipt.claimedAt > 5000 || observedAt > now ||
      issue.last_observed !== issue.first_observed || !Array.isArray(services) || services.length !== 1 ||
      services[0]?.name !== p.service || services[0]?.type !== "SERVICE_TYPE_WORKER" ||
      services[0]?.first_observed !== issue.first_observed || services[0]?.last_observed !== issue.first_observed)
    throw rejected();
  // No title, stack, raw body, request context, model input or target identity
  // supplied by the event escapes. The downstream host pins its own fixture.
  // source is the host's independently retained deployment-version -> source
  // mapping; a Worker self-report is not source/occurrence API attestation.
  return { policy: p.policy, issue: issue.id, correlation: event.alert_correlation_id,
    service: p.service, source: p.source, version: p.version, emission: p.emission,
    fixtureDigest: p.fixtureDigest, claimedAt: receipt.claimedAt, observedAt };
}

export interface PublicIncidentOutbox {
  version: 1;
  state: "dispatching" | "dispatched";
  digest: string;
  instance: string;
  admission: PublicIncidentAdmission;
}
/** One permanent slot PER HOST enrollment, not per transport digest or Issue ID.
 * The host storage adapter must implement claim+acknowledge atomically. There is
 * intentionally no delete/reset/fail-and-retry method or caller-chosen slot.
 */
export interface PublicIncidentOutboxStore {
  read(): Promise<unknown>;
  claim(record: PublicIncidentOutbox): Promise<boolean>;
  acknowledge(digest: string): Promise<void>;
}
const admissionKeys = ["policy", "issue", "correlation", "service", "source", "version", "emission", "fixtureDigest", "claimedAt", "observedAt"];
export async function publicIncidentIdentity(admission: PublicIncidentAdmission) {
  const v = exact(admission, admissionKeys);
  if (!identifier(v.policy) || !uuid(v.issue) || !uuid(v.correlation) || !identifier(v.service) ||
      !sha(v.source, 40) || !uuid(v.version) || !identifier(v.emission) || !sha(v.fixtureDigest, 64) ||
      typeof v.claimedAt !== "number" || !Number.isSafeInteger(v.claimedAt) || v.claimedAt < 0 ||
      typeof v.observedAt !== "number" || !Number.isSafeInteger(v.observedAt) ||
      v.observedAt < v.claimedAt || v.observedAt - v.claimedAt > 5000) throw rejected();
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(JSON.stringify(admissionKeys.map(k => v[k])))))].map(b => b.toString(16).padStart(2, "0")).join("");
  return { digest, instance: `public-incident-${digest}`,
    admission: v as unknown as PublicIncidentAdmission };
}
/** Read-only validation for a started Workflow to recover the immutable admitted
 * identity even while the create acknowledgement is still in flight. Pending is
 * readable evidence, NEVER authority to dispatch a second Workflow.
 */
export async function readPublicIncidentOutbox(raw: unknown): Promise<PublicIncidentOutbox> {
  const r = exact(raw, ["version", "state", "digest", "instance", "admission"]);
  if (r.version !== 1 || !["dispatching", "dispatched"].includes(r.state as string)) throw rejected();
  const expected = await publicIncidentIdentity(r.admission as PublicIncidentAdmission);
  if (r.digest !== expected.digest || r.instance !== expected.instance) throw rejected();
  return { version: 1, state: r.state as PublicIncidentOutbox["state"], ...expected };
}
/** Host dispatch closure fixes the Workflow destination; an ACK must identify
 * this SAME deterministic instance. It must never dispatch a replacement ID.
 * Any send/ACK/SQLite uncertainty leaves dispatching and prevents another send.
 * Recovery is a separately authorized read/reconciliation of that same instance.
 */
export async function dispatchPublicIncident(
  store: PublicIncidentOutboxStore,
  admitted: PublicIncidentAdmission,
  dispatch: (instance: string) => Promise<{ id: string }>,
) {
  const expected = await publicIncidentIdentity(admitted);
  const replay = (raw: unknown) => {
    const r = exact(raw, ["version", "state", "digest", "instance", "admission"]);
    const saved = exact(r.admission, admissionKeys);
    if (r.version !== 1 || r.state !== "dispatched" || r.digest !== expected.digest ||
        r.instance !== expected.instance || admissionKeys.some(k => saved[k] !== (expected.admission as unknown as Record<string, unknown>)[k])) throw rejected();
    return { ...expected, replay: true };
  };
  const old = await store.read();
  if (old !== undefined) return replay(old);
  if (!await store.claim({ version: 1, state: "dispatching", ...expected }))
    return replay(await store.read());
  // No catch which marks absent/failed and no retry. The claim survives even
  // when creation persisted but the caller never received its acknowledgement.
  const ack = exact(await dispatch(expected.instance), ["id"]);
  if (ack.id !== expected.instance) throw rejected();
  await store.acknowledge(expected.digest);
  return { ...expected, replay: false };
}
