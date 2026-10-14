import { cloudflareBindingProvider } from "@flue/runtime/cloudflare/workers-ai";
import { MODEL, RESERVATION_CENTS, LIMIT_CENTS } from "./protocol.ts";
import { flueBudgetInput, flueProposalInput, assertProposalStream } from "./policy.ts";

export interface FlueBudgetService {
  runStream(
    run: string,
    id: string,
    model: string,
    input: unknown,
  ): Promise<{
    reservationId: string;
    reservedCents: number;
    body: string;
    byteLength: number;
    contentType: string;
  }>;
}

/** Trusted host supplies run identity and per-invocation IDs, never project/model. */
export function budgetedFlueProvider(
  run: string,
  budget: FlueBudgetService,
  nextReservation: () => string,
  policy?: { proposalOnly: true },
) {
  if (typeof run !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(run))
    throw new Error("Flue host run rejected");
  let halted = false;
  const provider = cloudflareBindingProvider({
    gateway: false,
    streamIdleTimeoutMs: 50_000,
    binding: {
      async run(model, input, options) {
        try {
          if (halted) throw new Error("halted");
          const bounded = policy?.proposalOnly
            ? await flueProposalInput(model, input, options)
            : flueBudgetInput(model, input, options);
          const signal =
            options &&
            (Object.getOwnPropertyDescriptor(options, "signal")?.value as AbortSignal | undefined);
          const id = nextReservation();
          if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(id))
            throw new Error("identity");
          const result = await budget.runStream(run, id, MODEL, {
            messages: bounded.messages,
            stream: true,
            stream_options: { include_usage: true },
            max_completion_tokens: bounded.max_tokens,
            temperature: 0,
          });
          if (
            result.reservationId !== id ||
            result.contentType !== "text/event-stream" ||
            typeof result.body !== "string" ||
            new TextEncoder().encode(result.body).length !== result.byteLength ||
            result.byteLength < 1 ||
            result.byteLength > 65536 ||
            !Number.isSafeInteger(result.reservedCents) ||
            result.reservedCents < RESERVATION_CENTS ||
            result.reservedCents > LIMIT_CENTS ||
            result.reservedCents % RESERVATION_CENTS !== 0
          )
            throw new Error("receipt");
          // Cancellation never refunds a reservation. No automatic re-inference.
          if (signal?.aborted) throw new Error("aborted");
          if (policy?.proposalOnly) assertProposalStream(result.body);
          return new Response(result.body, { headers: { "content-type": result.contentType } });
        } catch {
          halted = true;
          throw new Error("Budgeted Flue inference failed; inspect reservations before retrying");
        }
      },
    },
  });
  const fixed = provider.getModels().filter((model) => model.id === MODEL);
  if (fixed.length !== 1) throw new Error("Pinned Flue model unavailable");
  return { ...provider, getModels: () => fixed, filterModels: () => fixed };
}
