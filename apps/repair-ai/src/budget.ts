// Fixed lifetime authorization. Never include a caller-selected budget name or date.
export const BUDGET_NAME = "friday-demo-repair-2-usd-v1";
export {
  MODEL,
  LIMIT_CENTS,
  RESERVATION_CENTS,
  MAX_OUTPUT_TOKENS,
} from "@effect-ci-testbed/flue-budget-provider/protocol";
import {
  MODEL,
  LIMIT_CENTS,
  RESERVATION_CENTS,
} from "@effect-ci-testbed/flue-budget-provider/protocol";
export const MAX_RUN_CALLS = 4;

export interface Reservation {
  id: string;
  run: string;
}
export interface Ledger {
  version: 1;
  reservations: Reservation[];
}
export interface BudgetStore {
  // Must atomically read, validate and commit before any inference starts.
  update<T>(operation: (current: unknown) => { ledger: Ledger; result: T }): Promise<T>;
}
export { inputFor, type InferenceInput } from "@effect-ci-testbed/flue-budget-provider/protocol";
import { inputFor, type InferenceInput } from "@effect-ci-testbed/flue-budget-provider/protocol";
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
const invalid = () => new Error("Inference budget request rejected");

function ledgerFor(value: unknown): Ledger {
  if (value === undefined) return { version: 1, reservations: [] };
  if (
    !object(value) ||
    value.version !== 1 ||
    !exactKeys(value, ["version", "reservations"]) ||
    !Array.isArray(value.reservations) ||
    value.reservations.length > LIMIT_CENTS / RESERVATION_CENTS
  )
    throw new Error("Inference budget ledger unavailable");
  const ids = new Set<string>();
  const runs = new Map<string, number>();
  const reservations = value.reservations.map((entry) => {
    if (
      !object(entry) ||
      !exactKeys(entry, ["id", "run"]) ||
      !identifier(entry.id) ||
      !identifier(entry.run) ||
      ids.has(entry.id)
    )
      throw new Error("Inference budget ledger unavailable");
    ids.add(entry.id);
    const count = (runs.get(entry.run) ?? 0) + 1;
    if (count > MAX_RUN_CALLS) throw new Error("Inference budget ledger unavailable");
    runs.set(entry.run, count);
    return { id: entry.id, run: entry.run };
  });
  return { version: 1, reservations };
}

export function budgetStatus(current: unknown) {
  const ledger = ledgerFor(current);
  return {
    budget: BUDGET_NAME,
    reservedCents: ledger.reservations.length * RESERVATION_CENTS,
    remainingCents: LIMIT_CENTS - ledger.reservations.length * RESERVATION_CENTS,
    reservations: ledger.reservations,
  };
}

export async function reserve(store: BudgetStore, run: unknown, id: unknown) {
  if (!identifier(run) || !identifier(id)) throw invalid();
  return store.update((current) => {
    const ledger = ledgerFor(current);
    if (ledger.reservations.some((entry) => entry.id === id))
      throw new Error("Inference reservation already consumed");
    if (
      ledger.reservations.length >= LIMIT_CENTS / RESERVATION_CENTS ||
      ledger.reservations.filter((entry) => entry.run === run).length >= MAX_RUN_CALLS
    )
      throw new Error("Inference budget exhausted");
    ledger.reservations.push({ id, run });
    return {
      ledger,
      result: { reservedCents: ledger.reservations.length * RESERVATION_CENTS, reservationId: id },
    };
  });
}

/** No retry, refund, paid fallback, logging or gateway options. Outputs remain untrusted. */
export async function infer(
  store: BudgetStore,
  binding: { run(model: string, input: InferenceInput): Promise<unknown> },
  run: unknown,
  id: unknown,
  model: unknown,
  input: unknown,
) {
  const bounded = inputFor(model, input);
  const receipt = await reserve(store, run, id);
  let output: unknown;
  try {
    output = await binding.run(MODEL, bounded);
  } catch {
    throw new Error("Reserved inference failed; reservation retained");
  }
  // Only text transport in this first slice. No tools/streams or executable patches.
  if (
    !object(output) ||
    typeof output.response !== "string" ||
    new TextEncoder().encode(output.response).length > 32_768
  )
    throw new Error("Reserved inference returned unsupported output; reservation retained");
  return { ...receipt, response: output.response };
}
