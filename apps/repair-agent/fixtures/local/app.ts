import { env } from "cloudflare:workers";
import "./provider.ts";
import { init } from "@flue/runtime";
import { OwnedRepairProposal } from "./agent.ts";
import { runProposal, type BudgetInspection } from "./proposal.ts";
export default {
  async fetch(request: Request) {
    const input = (await request.json()) as {
      mode: string;
      receipt: Parameters<ReturnType<typeof init>["read"]>[0];
    };
    const budget = (env as unknown as { REPAIR_AI: BudgetInspection }).REPAIR_AI;
    if (input.mode === "read")
      return Response.json({
        reply: await init(OwnedRepairProposal, { id: "owned_local" }).read(input.receipt),
        budget: await budget.status(),
        fakeInference: true,
      });
    try {
      return Response.json({
        result: await runProposal(
          "local",
          { mode: input.mode },
          {
            async do(_name, _options, callback) {
              return callback();
            },
          },
          budget,
        ),
        fakeInference: true,
      });
    } catch {
      return Response.json(
        {
          error: "Owned test proposal rejected",
          budget: await budget.status(),
          fakeInference: true,
        },
        { status: 400 },
      );
    }
  },
};
