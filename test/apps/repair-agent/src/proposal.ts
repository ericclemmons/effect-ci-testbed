import { init } from "@flue/runtime";
import { OwnedRepairProposal } from "./agent.ts";
import { HOST_RUN } from "./provider.ts";
import { probeMode } from "./probe-mode.ts";
export interface BudgetStatus {
  budget: string;
  reservedCents: number;
  remainingCents: number;
  reservations: { id: string; run: string }[];
}
export interface BudgetInspection {
  status(): Promise<BudgetStatus>;
}
export interface ProposalSteps {
  do<T extends Rpc.Serializable<T>>(
    name: string,
    options: { retries: { limit: 0; delay: "1 second" }; timeout: "2 minutes" },
    callback: () => Promise<T>,
  ): Promise<T>;
}
const options = { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" } as const;
export async function runProposal(
  instance: string,
  payload: unknown,
  step: ProposalSteps,
  budget: BudgetInspection,
  validateBeforeInference?: (status: BudgetStatus) => void,
) {
  const mode = probeMode(instance, payload);
  const before = await step.do("proposal:budget-before", options, () => budget.status());
  if (mode === "inspect") return { before, inferenceCalled: false };
  validateBeforeInference?.(before);
  const handle = init(OwnedRepairProposal, { id: `owned_${instance}` });
  const receipt = await step.do("proposal:admit", options, () =>
    handle.dispatch("Return only the corrected owned healthStatus function. No tools or Markdown."),
  );
  const reply = await step.do("proposal:read", options, async () => {
    const original = await handle.read(receipt, { signal: AbortSignal.timeout(90_000) });
    if (
      typeof original.text !== "string" ||
      !original.text.trim() ||
      new TextEncoder().encode(original.text).length > 32768 ||
      typeof original.metadata?.reservationId !== "string"
    )
      throw new Error("Proposal evidence mismatch");
    return { text: original.text, reservationId: original.metadata.reservationId };
  });
  const after = await step.do("proposal:budget-after", options, () => budget.status());
  const reservationId = reply.reservationId;
  if (
    typeof reply.text !== "string" ||
    !reply.text.trim() ||
    new TextEncoder().encode(reply.text).length > 32768 ||
    typeof reservationId !== "string" ||
    after.reservedCents !== before.reservedCents + 10 ||
    !after.reservations.some((r) => r.id === reservationId && r.run === HOST_RUN)
  )
    throw new Error("Proposal evidence mismatch");
  return {
    before,
    after,
    receipt,
    text: reply.text,
    reservationId,
    proposalOnly: true,
    repairVerified: false,
  };
}
