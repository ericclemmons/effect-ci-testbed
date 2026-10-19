import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  runIncidentProposal,
  type IncidentAdmissionReader,
} from "./incident-proposal.ts";
import type { BudgetInspection } from "./proposal.ts";
interface Environment {
  REPAIR_AI: BudgetInspection;
  OWNED_INCIDENT: IncidentAdmissionReader;
}
export class IncidentProposalWorkflow extends WorkflowEntrypoint<
  Environment,
  unknown
> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    try {
      return await runIncidentProposal(
        event.instanceId,
        event.payload,
        step,
        this.env.OWNED_INCIDENT,
        this.env.REPAIR_AI,
      );
    } catch {
      throw new NonRetryableError(
        "Owned incident proposal failed; reconcile this SAME Workflow/agent/slot before any paid retry",
      );
    }
  }
}
