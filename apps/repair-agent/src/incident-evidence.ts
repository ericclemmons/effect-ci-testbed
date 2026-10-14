import {
  WorkerEntrypoint,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { INCIDENT_PROPOSAL_INSTANCE } from "@effect-ci-testbed/github/incident-proposal";
import {
  incidentProposalFromHistory,
  type IncidentProposalEvidence as Evidence,
} from "@effect-ci-testbed/github/incident-evidence";
import type { BudgetInspection } from "./proposal.ts";
/** Read-only private capability: no dispatch, writer, raw capture or credential. */
export class IncidentProposalEvidence extends WorkerEntrypoint<{
  REPAIR_AI: BudgetInspection;
}> {
  async readIncident(): Promise<Evidence> {
    const workflow = (
      this.ctx.exports as unknown as { IncidentProposalWorkflow: Workflow }
    ).IncidentProposalWorkflow;
    const history = await (
      await workflow.get(INCIDENT_PROPOSAL_INSTANCE)
    ).status();
    return incidentProposalFromHistory(
      history,
      await this.env.REPAIR_AI.status(),
    );
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}
export class IncidentEvidenceWorkflow extends WorkflowEntrypoint<{}, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    try {
      const value = event.payload;
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Reflect.ownKeys(value).length !== 1
      )
        throw new Error("Fixed read required");
      const mode = Object.getOwnPropertyDescriptor(value, "mode");
      if (!mode || !("value" in mode) || mode.value !== "read")
        throw new Error("Fixed read required");
      return await step.do(
        "incident:read-proposal-evidence",
        { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" },
        async () => {
          const evidence = (
            this.ctx.exports as unknown as {
              IncidentProposalEvidence: (props: {}) => Service<IncidentProposalEvidence>;
            }
          ).IncidentProposalEvidence({});
          const r = await evidence.readIncident();
          return {
            instance: r.instance,
            reservationId: r.reservationId,
            run: r.run,
            text: r.text,
            issueId: r.issueId,
            operationId: r.operationId,
            activationPolicy: r.activationPolicy,
          };
        },
      );
    } catch {
      throw new NonRetryableError(
        "Native incident proposal evidence unavailable",
      );
    }
  }
}
