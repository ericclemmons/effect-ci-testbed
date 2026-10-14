import { AsyncLocalStorage } from "node:async_hooks";
import { instrument, setProvider } from "@flue/runtime";
import { getCloudflareContext, getDurableObjectIdentity } from "@flue/runtime/cloudflare";
import {
  budgetedFlueProvider,
  type FlueBudgetService,
} from "@effect-ci-testbed/flue-budget-provider";

export const HOST_RUN = "friday-flue-proposal-v1";
const scope = new AsyncLocalStorage<{ reservation: string }>();
const invocation = new AsyncLocalStorage<{
  operationId: string;
  submissionId: string;
  instanceId: string;
}>();
const rejected = () =>
  new Error("Owned Flue model context rejected; inspect durable slots before retrying");
const bounded = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 256;

instrument({
  observe() {},
  dispose() {},
  async interceptor(operation, context, next) {
    if (operation.type === "tool" || operation.type === "task") throw rejected();
    if (operation.type === "agent") {
      if (operation.operationKind !== "prompt" || !bounded(operation.operationId)) throw rejected();
      const parent = invocation.getStore();
      // Pinned Flue wraps the owned submission, then a nested session prompt.
      // The nested context omits submission identity; inherit ONLY our trusted
      // outer interceptor, never a model header or a global mutable fallback.
      if (parent) {
        if (
          (context.submissionId !== undefined && context.submissionId !== parent.submissionId) ||
          (context.instanceId !== undefined && context.instanceId !== parent.instanceId)
        )
          throw rejected();
        return next();
      }
      if (
        !bounded(context.submissionId) ||
        !bounded(context.instanceId) ||
        context.agentName !== "OwnedRepairProposal" ||
        operation.operationId !== context.submissionId
      )
        throw rejected();
      return invocation.run(
        {
          operationId: operation.operationId,
          submissionId: context.submissionId,
          instanceId: context.instanceId,
        },
        next,
      );
    }
    if (operation.type !== "model") return next();
    const identity = getDurableObjectIdentity();
    const parent = invocation.getStore();
    if (
      identity.className !== "FlueOwnedRepairProposalAgent" ||
      identity.bindingName !== "FLUE_OWNED_REPAIR_PROPOSAL_AGENT" ||
      !bounded(identity.id) ||
      !parent ||
      !bounded(operation.turnId) ||
      (context.submissionId !== undefined && context.submissionId !== parent.submissionId) ||
      (context.instanceId !== undefined && context.instanceId !== parent.instanceId)
    )
      throw rejected();
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            JSON.stringify([
              identity.className,
              identity.id,
              parent.instanceId,
              parent.submissionId,
            ]),
          ),
        ),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const reservation = `flue_${digest}`;
    const sql = getCloudflareContext().storage.sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS effect_ci_model_slots_v1 (submission TEXT PRIMARY KEY, operation TEXT NOT NULL, turn TEXT NOT NULL, reservation TEXT NOT NULL UNIQUE)",
    );
    const existing = sql
      .exec(
        "SELECT operation, turn, reservation FROM effect_ci_model_slots_v1 WHERE submission = ?",
        parent.submissionId,
      )
      .toArray();
    if (existing.length) {
      if (
        existing.length !== 1 ||
        existing[0].operation !== parent.operationId ||
        existing[0].turn !== operation.turnId ||
        existing[0].reservation !== reservation
      )
        throw rejected();
    } else {
      // This probe owns exactly one submission per DO. No new slot after uncertainty.
      if (sql.exec("SELECT COUNT(*) AS n FROM effect_ci_model_slots_v1").toArray()[0].n !== 0)
        throw rejected();
      sql.exec(
        "INSERT INTO effect_ci_model_slots_v1 VALUES (?, ?, ?, ?)",
        parent.submissionId,
        parent.operationId,
        operation.turnId,
        reservation,
      );
    }
    return scope.run({ reservation }, next);
  },
});

setProvider(
  budgetedFlueProvider(
    HOST_RUN,
    {
      async runStream(...args) {
        if (scope.getStore()?.reservation !== args[1]) throw rejected();
        const service = getCloudflareContext().env.REPAIR_AI as FlueBudgetService;
        if (!service || typeof service.runStream !== "function") throw rejected();
        return service.runStream(...args);
      },
    },
    () => {
      const context = scope.getStore();
      if (!context) throw rejected();
      return context.reservation;
    },
    { proposalOnly: true },
  ),
);
