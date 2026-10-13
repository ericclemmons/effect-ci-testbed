import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import {
  BUDGET_NAME,
  budgetStatus,
  infer,
  type BudgetStore,
  type InferenceInput,
} from "./budget.ts";
import { inferStream, type StreamBinding } from "./budget-stream.ts";
export { BudgetProbeWorkflow } from "./probe.ts";

interface Environment {
  AI: StreamBinding & { run(model: string, input: InferenceInput): Promise<unknown> };
}

export class InferenceBudgetObject extends DurableObject<Environment> {
  private store(): BudgetStore {
    return {
      update: (operation) =>
        this.ctx.storage.transaction(async (storage) => {
          const { ledger, result } = operation(await storage.get("ledger"));
          await storage.put("ledger", ledger);
          return result;
        }),
    };
  }
  async status() {
    return budgetStatus(await this.ctx.storage.get("ledger"));
  }
  run(run: string, reservationId: string, model: string, input: unknown) {
    return infer(this.store(), this.env.AI, run, reservationId, model, input);
  }
  runStream(run: string, reservationId: string, model: string, input: unknown) {
    return inferStream(this.store(), this.env.AI, run, reservationId, model, input);
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}

/** RPC-only, host-owned service; never bind this to an untrusted project Worker. */
export default class RepairAIWorker extends WorkerEntrypoint<Environment> {
  status() {
    const namespace = (
      this.ctx.exports as unknown as {
        InferenceBudgetObject: DurableObjectNamespace<InferenceBudgetObject>;
      }
    ).InferenceBudgetObject;
    return namespace.getByName(BUDGET_NAME).status();
  }
  run(run: string, reservationId: string, model: string, input: unknown) {
    const namespace = (
      this.ctx.exports as unknown as {
        InferenceBudgetObject: DurableObjectNamespace<InferenceBudgetObject>;
      }
    ).InferenceBudgetObject;
    return namespace.getByName(BUDGET_NAME).run(run, reservationId, model, input);
  }
  runStream(run: string, reservationId: string, model: string, input: unknown) {
    const namespace = (
      this.ctx.exports as unknown as {
        InferenceBudgetObject: DurableObjectNamespace<InferenceBudgetObject>;
      }
    ).InferenceBudgetObject;
    return namespace.getByName(BUDGET_NAME).runStream(run, reservationId, model, input);
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}
