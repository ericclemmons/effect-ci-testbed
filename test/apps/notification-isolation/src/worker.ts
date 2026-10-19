import { DurableObject, WorkerEntrypoint, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import { Notifications, notificationLayer } from "@effect-ci-testbed/github-cloudflare/notifications";
import { RunCard, type RunSnapshot } from "@effect-ci-testbed/github-cloudflare/run-card";
import { fixtureMode } from "./mode.ts";

const once = { retries: { limit: 0, delay: "1 second" }, timeout: "20 seconds" } as const;
interface RecordValue { owner: string; version: string; updates: number; snapshot: RunSnapshot }
export class DeliveryJournal extends DurableObject {
  async deliver(snapshot: RunSnapshot) {
    const owner = snapshot.identity.instanceId, version = snapshot.identity.revision;
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(owner) || new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 16_384)
      throw Error("Invalid owned message");
    await this.ctx.storage.transaction(async storage => {
      const previous = await storage.get<RecordValue>("message");
      if (previous && (previous.owner !== owner || previous.version !== version)) throw Error("Owned message identity mismatch");
      if ((previous?.updates ?? 0) >= 64) throw Error("Owned message update limit reached");
      await storage.put("message", { owner, version, updates: (previous?.updates ?? 0) + 1, snapshot });
    });
    return { message: owner };
  }
  read() { return this.ctx.storage.get<RecordValue>("message"); }
  override fetch() { return new Response("Not found", { status: 404 }); }
}
export class RejectingDestination extends WorkerEntrypoint {
  async deliver(): Promise<never> { throw Error("Owned notification destination rejected"); }
  override fetch() { return new Response("Not found", { status: 404 }); }
}
export class ProviderIsolation extends WorkflowEntrypoint<{ WORKER_METADATA: { id: string } }, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    let mode;
    try { mode = fixtureMode(event.payload); }
    catch { throw new NonRetryableError("Exact owned notification fixture mode required"); }
    const workerVersion = this.env.WORKER_METADATA?.id;
    if (typeof workerVersion !== "string" || workerVersion.length < 1 || workerVersion.length > 128)
      throw new NonRetryableError("Worker version identity unavailable");
    const capabilities = this.ctx.exports as unknown as {
      RejectingDestination: () => { deliver(): Promise<never> };
      DeliveryJournal: DurableObjectNamespace<DeliveryJournal>;
    };
    const journal = capabilities.DeliveryJournal.getByName(event.instanceId);
    const card = new RunCard({ instanceId: event.instanceId, repository: "owned-notification-fixture",
      revision: `worker-version:${workerVersion}` });
    const invocations = { rejecting: 0, journal: 0 };
    const observerInvocations = { rejecting: 0, journal: 0 };
    const observers = mode.startsWith("observer-") ? CI.makeRuntimeObservers([
      { id: "rejecting", deliver: async () => {
        observerInvocations.rejecting++;
        await capabilities.RejectingDestination().deliver();
      } },
      { id: "journal", deliver: async () => {
        observerInvocations.journal++;
        const receipt = await journal.deliver(card.snapshot());
        receipt[Symbol.dispose]?.();
      } },
    ]) : undefined;
    const layer = notificationLayer([
      { id: "rejecting", deliver: () => {
        invocations.rejecting++;
        return mode === "provider-timeout" ? Effect.never : Effect.tryPromise(() => capabilities.RejectingDestination().deliver());
      } },
      { id: "journal", deliver: snapshot => Effect.tryPromise(async () => {
        invocations.journal++;
        const receipt = await journal.deliver(snapshot);
        try { return { message: receipt.message }; }
        finally { receipt[Symbol.dispose]?.(); }
      }) },
    ], (provider, key, deliver) => step.do(`provider:${provider}:${key}`, once, deliver));
    const business = CI.action<string>("business", () => function* () {
      if (mode === "business-failure" || mode === "observer-business-failure") throw Error("Original owned business failure");
      return "business succeeded";
    });
    let sequence = 0;
    const result = await CI.runPromise(CI.workflow("notification-isolation", () => business()), {
      ci: true, env: "owned-notification-fixture", output: "silent",
      ...(observers ? { observers } : {}),
      onEvent: async runtimeEvent => {
        if (++sequence > 64) throw Error("Owned event limit reached");
        card.update(runtimeEvent);
        const snapshot = card.snapshot();
        const deliveries = await Effect.runPromise(Effect.gen(function* () {
          return yield* (yield* Notifications).publish(String(sequence), snapshot);
        }).pipe(Effect.provide(layer)));
        await step.do(`delivery-status:${sequence}`, once, async () => ({ phase: snapshot.phase, deliveries }));
      },
      onAttempt: async attempt => {
        if (observers) await step.do("observer-status", once, async () => ({ ...observers.snapshot(), invocations: { ...observerInvocations } }));
        await step.do("business-result", once, async () => ({ conclusion: attempt.conclusion, workflow: attempt.workflowId }));
        await step.do("provider-invocations", once, async () => ({ ...invocations }));
        await step.do("journal:final", once, async () => {
          const value = await journal.read();
          if (!value) return null;
          try { return { owner: value.owner, version: value.version, updates: value.updates,
            snapshot: JSON.parse(JSON.stringify(value.snapshot)) as RunSnapshot }; }
          finally { value[Symbol.dispose]?.(); }
        });
      },
    });
    return { mode, value: result.value, workerVersion, containers: 0 };
  }
}
export default { fetch: () => new Response("Not found", { status: 404 }) };
