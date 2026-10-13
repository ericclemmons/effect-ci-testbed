import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import { BUDGET_NAME } from "./budget.ts"
import type { InferenceBudgetObject } from "./worker.ts"
import { runBudgetProbe } from "./probe-policy.ts"

/** No fetch route or event-prompt forwarding. Account-authenticated Workflow dispatch. */
export class BudgetProbeWorkflow extends WorkflowEntrypoint<{}, { mode: "inspect" | "proposal" }> {
  override async run(event: Readonly<WorkflowEvent<{ mode: "inspect" | "proposal" }>>, step: WorkflowStep) {
    const namespace = (this.ctx.exports as unknown as { InferenceBudgetObject: DurableObjectNamespace<InferenceBudgetObject> }).InferenceBudgetObject
    try { return await runBudgetProbe(event.instanceId, event.payload, step, namespace.getByName(BUDGET_NAME)) }
    catch { throw new NonRetryableError("Fixed budget probe failed; inspect reservations before retrying") }
  }
}
