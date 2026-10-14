/** Fixed historical native proposal pilot, NOT an arbitrary incident or model API. */
export const RECORDED_INSTANCE = "coverage-flue-proposal-20261014-1";
export const RECORDED_RESERVATION =
  "flue_9215338e5c51bb55f8926ef9bcfb3186f4e970f83639929024685ab2ce2df43e";
export const RECORDED_RUN = "friday-flue-proposal-v1";
export const RECORDED_TEXT = "export function healthStatus() { return 200; }";
export interface RecordedProposal {
  instance: string;
  reservationId: string;
  run: string;
  text: string;
}
const reject = () => new Error("Recorded native proposal evidence rejected");
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw reject();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) throw reject();
  return descriptor.value;
}
function rows(value: unknown, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw reject();
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) throw reject();
    return descriptor.value;
  });
}
export function assertRecordedProposal(value: unknown): RecordedProposal {
  if (
    field(value, "instance") !== RECORDED_INSTANCE ||
    field(value, "reservationId") !== RECORDED_RESERVATION ||
    field(value, "run") !== RECORDED_RUN ||
    field(value, "text") !== RECORDED_TEXT
  )
    throw reject();
  return {
    instance: RECORDED_INSTANCE,
    reservationId: RECORDED_RESERVATION,
    run: RECORDED_RUN,
    text: RECORDED_TEXT,
  };
}
/** Read trusted native Workflow history and independently retained broker identity. */
export function recordedProposalFromHistory(history: unknown, ledger: unknown): RecordedProposal {
  if (field(history, "status") !== "complete") throw reject();
  const output = field(history, "output");
  if (
    field(output, "proposalOnly") !== true ||
    field(output, "repairVerified") !== false ||
    field(output, "text") !== RECORDED_TEXT ||
    field(output, "reservationId") !== RECORDED_RESERVATION
  )
    throw reject();
  const before = field(output, "before"),
    after = field(output, "after");
  if (
    field(before, "budget") !== "friday-demo-repair-2-usd-v1" ||
    field(after, "budget") !== "friday-demo-repair-2-usd-v1" ||
    field(before, "reservedCents") !== 30 ||
    field(before, "remainingCents") !== 670 ||
    field(after, "reservedCents") !== 40 ||
    field(after, "remainingCents") !== 660 ||
    field(ledger, "budget") !== "friday-demo-repair-2-usd-v1"
  )
    throw reject();
  const reservations = rows(field(ledger, "reservations"), 4, 70),
    reserved = field(ledger, "reservedCents"),
    remaining = field(ledger, "remainingCents");
  if (
    reserved !== reservations.length * 10 ||
    typeof remaining !== "number" ||
    remaining + Number(reserved) !== 700
  )
    throw reject();
  const ids = new Map<string, string>();
  let matched = 0;
  for (const item of reservations) {
    const id = field(item, "id"),
      run = field(item, "run");
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,96}$/.test(id) ||
      typeof run !== "string" ||
      run.length > 96 ||
      ids.has(id)
    )
      throw reject();
    ids.set(id, run);
    if (id === RECORDED_RESERVATION) {
      if (run !== RECORDED_RUN) throw reject();
      matched++;
    }
  }
  if (matched !== 1) throw reject();
  const old = rows(field(before, "reservations"), 3, 3);
  const past = rows(field(after, "reservations"), 4, 4);
  if (field(past[3], "id") !== RECORDED_RESERVATION || field(past[3], "run") !== RECORDED_RUN)
    throw reject();
  const pastIds = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const id = field(past[i], "id"),
      run = field(past[i], "run");
    if (
      typeof id !== "string" ||
      pastIds.has(id) ||
      ids.get(id) !== run ||
      (i < 3 && (field(old[i], "id") !== id || field(old[i], "run") !== run))
    )
      throw reject();
    pastIds.add(id);
  }
  return assertRecordedProposal({
    instance: RECORDED_INSTANCE,
    reservationId: RECORDED_RESERVATION,
    run: RECORDED_RUN,
    text: RECORDED_TEXT,
  });
}
