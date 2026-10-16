import { assertPublicAdmission, PUBLIC_MODEL_RUN, PUBLIC_REQUIRED_RESERVATIONS, type PublicProposalEvidence } from "./public-proposal.ts";
import { FIXED_SOURCE, REPAIR_REPOSITORY, REPAIR_PATH, repairSource } from "./repair.ts";
import { OWNED_BASE, OWNED_NODE_COMMAND } from "./repair-verifier.ts";
import type { OperationStore, RepairResult } from "./repair-operation.ts";
const rejected = () => new Error("Public repair operation rejected; inspect the SAME proposed repair before recovery");
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, "0")).join("");
function fields(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw rejected();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(k => typeof k !== "string" || !keys.includes(k))) throw rejected();
  const out: Record<string, unknown> = {};
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(value, key); if (!d || !("value" in d)) throw rejected(); out[key] = d.value; }
  return out;
}
export async function assertPublicProposalEvidence(instance: string, value: unknown): Promise<PublicProposalEvidence> {
  const v = fields(value, ["instance", "admission", "run", "reservationId", "text", "submissionId", "agentUid", "acceptedAt"]);
  const admitted = await assertPublicAdmission(instance, { instance: v.instance, admission: v.admission });
  if (v.run !== PUBLIC_MODEL_RUN || typeof v.reservationId !== "string" || !/^flue_[a-f0-9]{64}$/.test(v.reservationId) ||
      PUBLIC_REQUIRED_RESERVATIONS.some(([id]) => id === v.reservationId) ||
      typeof v.submissionId !== "string" || !/^sub_[a-zA-Z0-9_-]{1,100}$/.test(v.submissionId) ||
      typeof v.agentUid !== "string" || !/^inst_[a-zA-Z0-9_-]{1,100}$/.test(v.agentUid) ||
      typeof v.acceptedAt !== "string" || !Number.isFinite(Date.parse(v.acceptedAt)) || Date.parse(v.acceptedAt) < admitted.admission.observedAt)
    throw rejected();
  repairSource(v.text);
  return { ...admitted, run: PUBLIC_MODEL_RUN, reservationId: v.reservationId, text: v.text as string,
    submissionId: v.submissionId, agentUid: v.agentUid, acceptedAt: v.acceptedAt };
}
export const publicRepairRun = (e: PublicProposalEvidence) => `public-${e.admission.issue.replaceAll("-", "")}`;
async function digest(e: PublicProposalEvidence) {
  return hash(JSON.stringify(["public-proposed-pr-only-v1", REPAIR_REPOSITORY, OWNED_BASE, REPAIR_PATH,
    OWNED_NODE_COMMAND, FIXED_SOURCE, publicRepairRun(e), e]));
}
/** A failed slot is inspectable, never reset or promoted by reconciliation. */
export async function readFailedPublicRepair(value: unknown) {
  const r = fields(value, ["version", "state", "digest", "evidence"]);
  if (r.version !== 1 || r.state !== "failed") throw rejected();
  const e = r.evidence as PublicProposalEvidence;
  const evidence = await assertPublicProposalEvidence(e?.instance, e);
  if (r.digest !== await digest(evidence)) throw rejected();
  return { digest: r.digest as string, evidence };
}
async function result(value: unknown): Promise<RepairResult> {
  const r = fields(value, ["repository", "commit", "sourceDigest", "evidenceId", "pullRequest", "url", "created", "deploymentPerformed"]);
  if (r.repository !== REPAIR_REPOSITORY || typeof r.commit !== "string" || !/^[a-f0-9]{40}$/.test(r.commit) ||
      r.sourceDigest !== await hash(FIXED_SOURCE) || typeof r.evidenceId !== "string" || !/^github_check_[0-9]+$/.test(r.evidenceId) ||
      typeof r.pullRequest !== "number" || !Number.isSafeInteger(r.pullRequest) || r.pullRequest < 4 ||
      r.url !== `https://github.com/${REPAIR_REPOSITORY}/pull/${r.pullRequest}` || typeof r.created !== "boolean" || r.deploymentPerformed !== false)
    throw rejected();
  return r as unknown as RepairResult;
}
export type PublicRepairResult = RepairResult & {
  replay: boolean; instance: string; issue: string; modelReservationId: string;
  activationPolicy: "public-proposed-pr-only-v1";
};
function wrap(r: RepairResult, e: PublicProposalEvidence, replay: boolean): PublicRepairResult {
  return { ...r, ...(replay ? { created: false } : {}), replay, instance: e.instance,
    issue: e.admission.issue, modelReservationId: e.reservationId, activationPolicy: "public-proposed-pr-only-v1" };
}
/** Host readEvidence/propose closures only; never actor patch/proof parameters.
 * A single permanent writer slot, separate from all three historical repairs.
 * propose MUST run the exact-commit native verifier before proposing its PR.
 */
export async function runPublicRepair(instance: string, store: OperationStore,
  readEvidence: () => Promise<unknown>, propose: (evidence: PublicProposalEvidence) => Promise<RepairResult>,
): Promise<PublicRepairResult> {
  if (!/^public-incident-[a-f0-9]{64}$/.test(instance)) throw rejected();
  const previous = await store.read();
  if (previous !== undefined) {
    const r = fields(previous, ["version", "state", "digest", "evidence", "result"]);
    if (r.version !== 1 || r.state !== "complete") throw rejected();
    const e = await assertPublicProposalEvidence(instance, r.evidence);
    if (r.digest !== await digest(e)) throw rejected();
    return wrap(await result(r.result), e, true);
  }
  const evidence = await assertPublicProposalEvidence(instance, await readEvidence());
  const id = await digest(evidence);
  const pending = { version: 1 as const, state: "pending" as const, digest: id, evidence };
  if (!await store.claim(pending)) throw rejected();
  try {
    const verified = await result(await propose(evidence));
    await store.complete(id, verified);
    return wrap(verified, evidence, false);
  } catch {
    await store.fail(id).catch(() => undefined);
    throw rejected();
  }
}
