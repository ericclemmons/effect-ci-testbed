import {
  assertRecordedProposal,
  RECORDED_INSTANCE,
  RECORDED_RESERVATION,
  RECORDED_RUN,
  RECORDED_TEXT,
  type RecordedProposal,
} from "./recorded-proposal.ts";
import { REPAIR_REPOSITORY, REPAIR_PATH, FIXED_SOURCE, type proposeRepair } from "./repair.ts";
import { OWNED_BASE, OWNED_NODE_COMMAND } from "./repair-verifier.ts";
export const NATIVE_REPAIR_RUN = "friday-native-repair-20261014-1";
export type RepairResult = Awaited<ReturnType<typeof proposeRepair>>;
export type PilotResult = RepairResult & {
  replay: boolean;
  modelInstance: string;
  modelReservationId: string;
  workersIssuesVerified: false;
};
export interface PendingOperation {
  version: 1;
  state: "pending";
  digest: string;
}
export interface OperationStore {
  read(): Promise<unknown>;
  claim(record: PendingOperation): Promise<boolean>;
  complete(digest: string, result: RepairResult): Promise<void>;
  fail(digest: string): Promise<void>;
}
const reject = () => new Error("Owned native repair state rejected; inspect before any recovery");
const hash = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
export const operationDigest = () =>
  hash(
    JSON.stringify([
      REPAIR_REPOSITORY,
      OWNED_BASE,
      REPAIR_PATH,
      OWNED_NODE_COMMAND,
      FIXED_SOURCE,
      NATIVE_REPAIR_RUN,
      RECORDED_INSTANCE,
      RECORDED_RESERVATION,
      RECORDED_RUN,
      RECORDED_TEXT,
    ]),
  );
async function validateResult(value: any): Promise<RepairResult> {
  if (
    !value ||
    value.repository !== REPAIR_REPOSITORY ||
    typeof value.commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.commit) ||
    value.sourceDigest !== (await hash(FIXED_SOURCE)) ||
    typeof value.evidenceId !== "string" ||
    !/^github_check_[0-9]+$/.test(value.evidenceId) ||
    !Number.isSafeInteger(value.pullRequest) ||
    value.pullRequest < 1 ||
    value.url !== `https://github.com/${REPAIR_REPOSITORY}/pull/${value.pullRequest}` ||
    typeof value.created !== "boolean" ||
    value.deploymentPerformed !== false
  )
    throw reject();
  return {
    repository: REPAIR_REPOSITORY,
    commit: value.commit,
    sourceDigest: value.sourceDigest,
    evidenceId: value.evidenceId,
    pullRequest: value.pullRequest,
    url: value.url,
    created: value.created,
    deploymentPerformed: false,
  };
}
function wrap(result: RepairResult, replay: boolean): PilotResult {
  return {
    ...result,
    ...(replay ? { created: false } : {}),
    replay,
    modelInstance: RECORDED_INSTANCE,
    modelReservationId: RECORDED_RESERVATION,
    workersIssuesVerified: false,
  };
}
/** All callbacks are trusted host closures, never RPC/model inputs. One fixed operation. */
export async function runRecordedRepair(
  store: OperationStore,
  readEvidence: () => Promise<RecordedProposal>,
  propose: (evidence: RecordedProposal) => Promise<RepairResult>,
): Promise<PilotResult> {
  const digest = await operationDigest();
  const existing: any = await store.read();
  if (existing !== undefined) {
    if (existing?.version !== 1 || existing.digest !== digest || existing.state !== "complete")
      throw reject();
    return wrap(await validateResult(existing.result), true);
  }
  const evidence = assertRecordedProposal(await readEvidence());
  if (!(await store.claim({ version: 1, state: "pending", digest }))) throw reject();
  try {
    const result = await validateResult(await propose(evidence));
    await store.complete(digest, result); // Persist BEFORE acknowledgement; no duplicate PR on replay.
    return wrap(result, false);
  } catch {
    // Failed/lost responses retain the immutable identity. Never restart or select
    // a fresh operation ID automatically; owned Git branches may need inspection.
    await store.fail(digest).catch(() => undefined);
    throw reject();
  }
}
