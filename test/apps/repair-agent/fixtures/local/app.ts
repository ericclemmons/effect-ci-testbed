import { env } from "cloudflare:workers";
import "./provider.ts";
import { init } from "@flue/runtime";
import { OwnedRepairProposal } from "./agent.ts";
import { runProposal, type BudgetInspection } from "./proposal.ts";
import {
  runIncidentProposal,
  type IncidentAdmissionReader,
} from "./incident-proposal.ts";
import {
  INCIDENT_PROPOSAL_INSTANCE,
  INCIDENT_PROPOSAL_INSPECT,
} from "@effect-ci-testbed/github/incident-proposal";
export default {
  async fetch(request: Request) {
    const input = (await request.json()) as {
      mode: string;
      receipt: Parameters<ReturnType<typeof init>["read"]>[0];
    };
    const budget = (env as unknown as { REPAIR_AI: BudgetInspection })
      .REPAIR_AI;
    const admission = (
      env as unknown as {
        OWNED_INCIDENT: IncidentAdmissionReader & {
          invalidate(): Promise<void>;
        };
      }
    ).OWNED_INCIDENT;
    if (input.mode === "invalidate-incident") {
      await admission.invalidate();
      return Response.json({ fakeAdmission: true });
    }
    if (input.mode === "read")
      return Response.json({
        reply: await init(OwnedRepairProposal, { id: "owned_local" }).read(
          input.receipt,
        ),
        budget: await budget.status(),
        fakeInference: true,
      });
    try {
      if (
        input.mode === "incident-proposal" ||
        input.mode === "incident-inspect"
      ) {
        const mode =
          input.mode === "incident-proposal" ? "proposal" : "inspect";
        return Response.json({
          result: await runIncidentProposal(
            mode === "proposal"
              ? INCIDENT_PROPOSAL_INSTANCE
              : INCIDENT_PROPOSAL_INSPECT,
            { mode },
            {
              async do(_name, _options, callback) {
                return callback();
              },
            },
            admission,
            budget,
          ),
          fakeInference: true,
          fakeAdmission: true,
        });
      }
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
