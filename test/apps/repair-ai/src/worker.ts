import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import {
  BUDGET_NAME,
  LIMIT_CENTS,
  RESERVATION_CENTS,
  budgetStatus,
  infer,
  type BudgetStore,
  type InferenceInput,
} from "./budget.ts";
import { type StreamBinding } from "./budget-stream.ts";
import { recoverableStream, type StreamCallStore, type StreamCall } from "./stream-recovery.ts";
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
    const calls: StreamCallStore = {
      claim: (id, initial) =>
        this.ctx.storage.transaction(async (storage) => {
          const key = `stream-call-v1:${id}`;
          const existing = await storage.get<StreamCall>(key);
          if (existing !== undefined) return { fresh: false, call: existing };
          const ids = (await storage.get<string[]>("stream-call-ids-v1")) ?? [];
          if (
            !Array.isArray(ids) ||
            ids.length >= LIMIT_CENTS / RESERVATION_CENTS ||
            new Set(ids).size !== ids.length ||
            ids.some((value) => typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(value))
          )
            throw new Error("Stream call storage unavailable");
          await storage.put(key, initial);
          await storage.put("stream-call-ids-v1", [...ids, id]);
          return { fresh: true, call: initial };
        }),
      complete: (id, admitted, receipt) =>
        this.ctx.storage.transaction(async (storage) => {
          const key = `stream-call-v1:${id}`;
          const current = await storage.get<StreamCall>(key);
          if (
            !current ||
            current.version !== 1 ||
            current.state !== "pending" ||
            current.run !== admitted.run ||
            current.digest !== admitted.digest ||
            current.receipt !== undefined
          )
            throw new Error("Stream call storage unavailable");
          await storage.put(key, { ...admitted, state: "complete", receipt });
        }),
    };
    return recoverableStream(calls, this.store(), this.env.AI, run, reservationId, model, input);
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
