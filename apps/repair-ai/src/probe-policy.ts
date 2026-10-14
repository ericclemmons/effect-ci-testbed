import { MODEL, type budgetStatus, type infer } from "./budget.ts";
import { streamSummary, type inferStream } from "./budget-stream.ts";

export interface ProbeBudget {
  status(): Promise<ReturnType<typeof budgetStatus>>;
  run(run: string, id: string, model: string, input: unknown): ReturnType<typeof infer>;
  runStream?(
    run: string,
    id: string,
    model: string,
    input: unknown,
  ): ReturnType<typeof inferStream>;
}
export interface ProbeStep {
  do<T extends Rpc.Serializable<T>>(
    name: string,
    options: { retries: { limit: number; delay: "1 second" }; timeout: "1 minute" },
    callback: () => Promise<T>,
  ): Promise<T>;
}

const options = { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" } as const;

/** Authenticated administrative proof only: payload cannot supply prompts/model/tools. */
export async function runBudgetProbe(
  instance: string,
  payload: unknown,
  step: ProbeStep,
  budget: ProbeBudget,
) {
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/.test(instance) ||
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1 ||
    !("mode" in payload) ||
    !["inspect", "proposal", "stream", "recovery"].includes(payload.mode as string)
  )
    throw new Error("Explicit fixed budget probe mode required");
  if ((payload.mode === "stream" || payload.mode === "recovery") && !budget.runStream)
    throw new Error("Streaming budget unavailable");
  const before = await step.do("budget:before", options, () => budget.status());
  if (payload.mode === "inspect") return { before, inferenceCalled: false };
  if (payload.mode === "stream" || payload.mode === "recovery") {
    const result = await step.do("budget:owned-stream", options, () =>
      budget.runStream!("native-budget-probe", `probe_${instance}`, MODEL, {
        messages: [{ role: "user", content: "Reply with only OK. Do not use tools." }],
        stream: true,
        stream_options: { include_usage: true },
        max_completion_tokens: 128,
        temperature: 0,
      }),
    );
    if (payload.mode === "recovery") {
      const charged = await step.do("budget:charged", options, () => budget.status());
      const replay = await step.do("budget:replay-stream", options, () =>
        budget.runStream!("native-budget-probe", `probe_${instance}`, MODEL, {
          messages: [{ role: "user", content: "Reply with only OK. Do not use tools." }],
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: 128,
          temperature: 0,
        }),
      );
      const after = await step.do("budget:after", options, () => budget.status());
      if (
        charged.reservedCents !== before.reservedCents + 10 ||
        after.reservedCents !== charged.reservedCents ||
        JSON.stringify(after.reservations) !== JSON.stringify(charged.reservations) ||
        result.body !== replay.body ||
        result.byteLength !== replay.byteLength ||
        result.reservationId !== replay.reservationId ||
        result.reservedCents !== replay.reservedCents ||
        result.contentType !== "text/event-stream" ||
        replay.contentType !== result.contentType ||
        result.byteLength < 1 ||
        result.byteLength > 65_536 ||
        new TextEncoder().encode(result.body).byteLength !== result.byteLength
      )
        throw new Error("Native stream recovery evidence mismatch");
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(result.body)),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      return {
        before,
        charged,
        after,
        reservationId: result.reservationId,
        byteLength: result.byteLength,
        bodySha256: digest,
        replayMatches: true,
        inferenceCalled: true,
        replayInferenceCalled: false,
        flueVerified: false,
        repairVerified: false,
      };
    }
    const after = await step.do("budget:after", options, () => budget.status());
    return {
      before,
      after,
      reservationId: result.reservationId,
      byteLength: result.byteLength,
      protocol: streamSummary(result.body),
      inferenceCalled: true,
      flueVerified: false,
      repairVerified: false,
    };
  }
  const proposal = await step.do("budget:owned-proposal", options, () =>
    budget.run("native-budget-probe", `probe_${instance}`, MODEL, {
      messages: [
        {
          role: "system",
          content:
            "Propose a minimal JavaScript correction for the provided owned test fixture. Return only the corrected function. No tools, commands, network or explanation.",
        },
        {
          role: "user",
          content:
            "Fixture: export function healthStatus() { return 500; }\nFailing assertion: healthStatus() === 200. Correct the fixture.",
        },
      ],
      max_tokens: 128,
    }),
  );
  const after = await step.do("budget:after", options, () => budget.status());
  return {
    before,
    after,
    reservationId: proposal.reservationId,
    proposedText: proposal.response,
    inferenceCalled: true,
    patchApplied: false,
    flueVerified: false,
    repairVerified: false,
  };
}
