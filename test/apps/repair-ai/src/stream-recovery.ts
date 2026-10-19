import { MODEL, LIMIT_CENTS, RESERVATION_CENTS } from "./budget.ts";
import { inferStream, type StreamBinding } from "./budget-stream.ts";
import { flueBudgetInput } from "./flue-policy.ts";
import type { BudgetStore } from "./budget.ts";

type Receipt = Awaited<ReturnType<typeof inferStream>>;
export interface StreamCall {
  version: 1;
  run: string;
  digest: string;
  state: "pending" | "complete";
  receipt?: Receipt;
}
export interface StreamCallStore {
  /** Atomic create-only admission. An existing pending call is NEVER resumed. */
  claim(id: string, initial: StreamCall): Promise<{ fresh: boolean; call: StreamCall }>;
  /** Conditional completion of the originally admitted call. */
  complete(id: string, call: StreamCall, receipt: Receipt): Promise<void>;
}

const failure = () =>
  new Error("Streaming call unavailable; inspect retained reservation before retrying");
const identity = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,96}$/.test(value);

/** Durable same-ID recovery, not permission to retry an ambiguous paid request. */
export async function recoverableStream(
  calls: StreamCallStore,
  ledger: BudgetStore,
  binding: StreamBinding,
  run: string,
  id: string,
  model: string,
  payload: unknown,
) {
  try {
    if (!identity(run) || !identity(id)) throw failure();
    const input = flueBudgetInput(model, payload, { returnRawResponse: true });
    const bytes = new TextEncoder().encode(JSON.stringify({ model: MODEL, input }));
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const initial: StreamCall = { version: 1, run, digest, state: "pending" };
    const { fresh, call } = await calls.claim(id, initial);
    if (call.version !== 1 || call.run !== run || call.digest !== digest) throw failure();
    if (!fresh) {
      const receipt = call.receipt;
      if (
        call.state !== "complete" ||
        !receipt ||
        receipt.reservationId !== id ||
        receipt.contentType !== "text/event-stream" ||
        typeof receipt.body !== "string" ||
        receipt.byteLength < 1 ||
        receipt.byteLength > 65_536 ||
        new TextEncoder().encode(receipt.body).length !== receipt.byteLength ||
        !Number.isSafeInteger(receipt.reservedCents) ||
        receipt.reservedCents < RESERVATION_CENTS ||
        receipt.reservedCents > LIMIT_CENTS ||
        receipt.reservedCents % RESERVATION_CENTS !== 0
      )
        throw failure();
      return { ...receipt };
    }
    if (call.state !== "pending" || call.receipt !== undefined) throw failure();
    const receipt = await inferStream(ledger, binding, run, id, model, payload);
    // Persist ORIGINAL bytes before returning. Lost completion acknowledgement
    // can replay only if this write actually committed; otherwise fail closed.
    await calls.complete(id, initial, receipt);
    return receipt;
  } catch {
    throw failure();
  }
}
