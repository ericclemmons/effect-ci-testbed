import {
  DurableObject,
  WorkerEntrypoint,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { EMISSION_ID, ERROR_MESSAGE, healthStatus, mode } from "./fault.ts";
type Receipt = {
  emissionId: typeof EMISSION_ID;
  status: 500;
  replay: boolean;
  issueVerified: false;
};
type Stored = { version: 1; state: "pending" | "complete" };
const KEY = "owned-emission-v1";
export class OwnedFaultOnce extends DurableObject {
  async inspect() {
    const stored = await this.ctx.storage.get<Stored>(KEY);
    return {
      emissionId: EMISSION_ID,
      state: stored?.state ?? "absent",
      issueVerified: false,
    };
  }
  async emit(): Promise<Receipt> {
    const fresh = await this.ctx.storage.transaction(async (storage) => {
      const stored = await storage.get<Stored>(KEY);
      if (stored?.version === 1 && stored.state === "complete") return false;
      if (stored !== undefined)
        throw new Error("Owned emission uncertain; no automatic retry");
      // Claim BEFORE logging. A lost acknowledgement never produces another error.
      await storage.put(KEY, { version: 1, state: "pending" });
      return true;
    });
    if (fresh) {
      if (healthStatus() !== 500) throw new Error("Owned fixture changed");
      console.error(new Error(ERROR_MESSAGE));
      await this.ctx.storage.put(KEY, { version: 1, state: "complete" });
    }
    return {
      emissionId: EMISSION_ID,
      status: 500,
      replay: !fresh,
      issueVerified: false,
    };
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}
export class OwnedFaultSource extends WorkerEntrypoint {
  private store() {
    return (
      this.ctx.exports as unknown as {
        OwnedFaultOnce: DurableObjectNamespace<OwnedFaultOnce>;
      }
    ).OwnedFaultOnce.getByName(EMISSION_ID);
  }
  async inspect() {
    const result = await this.store().inspect();
    return {
      emissionId: result.emissionId,
      state: result.state,
      issueVerified: false,
    };
  }
  async emit(): Promise<Response> {
    const result = await this.store().emit();
    return Response.json(
      {
        emissionId: result.emissionId,
        status: result.status,
        replay: result.replay,
        issueVerified: false,
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}
export class OwnedIncidentWorkflow extends WorkflowEntrypoint<
  {},
  { mode: "inspect" | "emit-once" }
> {
  async run(
    event: Readonly<WorkflowEvent<{ mode: "inspect" | "emit-once" }>>,
    step: WorkflowStep,
  ) {
    try {
      const selected = mode(event.payload);
      return await step.do(
        `incident:${selected}`,
        { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" },
        async () => {
          const source = (
            this.ctx.exports as unknown as {
              OwnedFaultSource: (props: {}) => Service<OwnedFaultSource>;
            }
          ).OwnedFaultSource({});
          if (selected === "inspect") {
            const result = await source.inspect();
            return {
              emissionId: result.emissionId,
              state: result.state,
              issueVerified: false,
            };
          }
          const response = await source.emit();
          const result = (await response.json()) as Receipt;
          if (
            response.status !== 500 ||
            result.emissionId !== EMISSION_ID ||
            result.status !== 500 ||
            typeof result.replay !== "boolean" ||
            result.issueVerified !== false
          )
            throw new Error("Invalid owned response");
          return {
            emissionId: EMISSION_ID,
            status: 500,
            replay: result.replay,
            issueVerified: false,
          };
        },
      );
    } catch {
      throw new NonRetryableError(
        "Owned incident emission failed; inspect state before further action",
      );
    }
  }
}
export default class PrivateIncidentWorker extends WorkerEntrypoint {
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}
