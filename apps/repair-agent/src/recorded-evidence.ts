import { WorkerEntrypoint } from "cloudflare:workers";
import {
  RECORDED_INSTANCE,
  recordedProposalFromHistory,
} from "@effect-ci-testbed/github/recorded-proposal";
import type { BudgetInspection } from "./proposal.ts";
interface Environment {
  REPAIR_AI: BudgetInspection;
}
/** Private read-only capability: no agent dispatch, AI call, credentials or write tool. */
export class RecordedProposalEvidence extends WorkerEntrypoint<Environment> {
  async readRecorded() {
    const namespace = (this.ctx.exports as unknown as { ProposalProbeWorkflow: Workflow })
      .ProposalProbeWorkflow;
    const history = await (await namespace.get(RECORDED_INSTANCE)).status();
    const ledger = await this.env.REPAIR_AI.status();
    return recordedProposalFromHistory(history, ledger);
  }
  fetch() {
    return new Response("Not found", { status: 404 });
  }
}
