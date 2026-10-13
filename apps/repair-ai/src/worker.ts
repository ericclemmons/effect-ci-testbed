import { DurableObject, WorkerEntrypoint } from "cloudflare:workers"
import { BUDGET_NAME, infer, type BudgetStore, type InferenceInput } from "./budget.ts"

interface Environment { AI: { run(model: string, input: InferenceInput): Promise<unknown> } }

export class InferenceBudgetObject extends DurableObject<Environment> {
  run(run: string, reservationId: string, model: string, input: unknown) {
    const store: BudgetStore = {
      update: (operation) => this.ctx.storage.transaction(async (storage) => {
        const { ledger, result } = operation(await storage.get("ledger"))
        await storage.put("ledger", ledger)
        return result
      }),
    }
    return infer(store, this.env.AI, run, reservationId, model, input)
  }
  override fetch() { return new Response("Not found", { status: 404 }) }
}

/** RPC-only, host-owned service; never bind this to an untrusted project Worker. */
export default class RepairAIWorker extends WorkerEntrypoint<Environment> {
  run(run: string, reservationId: string, model: string, input: unknown) {
    const namespace = (this.ctx.exports as unknown as { InferenceBudgetObject: DurableObjectNamespace<InferenceBudgetObject> }).InferenceBudgetObject
    return namespace.getByName(BUDGET_NAME).run(run, reservationId, model, input)
  }
  override fetch() { return new Response("Not found", { status: 404 }) }
}
