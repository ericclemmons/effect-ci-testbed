import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { runProposal, type BudgetInspection } from "./proposal.ts";
interface Environment {
  REPAIR_AI: BudgetInspection;
}
export class ProposalProbeWorkflow extends WorkflowEntrypoint<
  Environment,
  { mode: "inspect" | "proposal" }
> {
  async run(event: Readonly<WorkflowEvent<{ mode: "inspect" | "proposal" }>>, step: WorkflowStep) {
    try {
      return await runProposal(event.instanceId, event.payload, step, this.env.REPAIR_AI);
    } catch {
      throw new NonRetryableError(
        "Owned Flue proposal failed; inspect durable slots and reservations before retrying",
      );
    }
  }
}
