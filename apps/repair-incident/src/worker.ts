import {
  DurableObject,
  WorkerEntrypoint,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { EMISSION_ID, ERROR_MESSAGE, healthStatus, mode } from "./fault.ts";
import { PUBLIC_EMISSION_ID, PUBLIC_FIXTURE_DIGEST, publicFaultFetch } from "./public-fault.ts";
// HOST SOURCE gate, not a caller/env flag. Keep false until the authenticated
// automatic pipeline and source/version/private-fixture enrollment are ready.
const publicFailureEnabled: boolean = false;

/** Separate durable record; never reads, resets or reuses the old RPC emission. */
interface PublicEnvironment { WORKER_METADATA: { id: string } }
interface PublicClaimRecord {
  version: 1;
  producerVersion: string;
  claimedAt: number;
  fixtureDigest: string;
}
function validPublicClaim(value: PublicClaimRecord | undefined): value is PublicClaimRecord {
  return !!value && value.version === 1 &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.producerVersion) &&
    Number.isSafeInteger(value.claimedAt) && value.claimedAt >= 0 &&
    value.fixtureDigest === PUBLIC_FIXTURE_DIGEST;
}
export class PublicFailureClaim extends DurableObject<PublicEnvironment> {
  async inspect() {
    const record = await this.ctx.storage.get<PublicClaimRecord>("public-http-emission-v1");
    if (record === undefined) return { state: "absent" as const };
    if (!validPublicClaim(record)) throw new Error("Owned public claim unavailable");
    return { emission: PUBLIC_EMISSION_ID, version: record.producerVersion,
      currentVersion: this.env.WORKER_METADATA.id, fixtureDigest: record.fixtureDigest,
      claimedAt: record.claimedAt };
  }
  async claim(): Promise<boolean> {
    return this.ctx.storage.transaction(async (storage) => {
      const stored = await storage.get<PublicClaimRecord>(
        "public-http-emission-v1",
      );
      if (stored !== undefined) {
        if (!validPublicClaim(stored))
          throw new Error("Owned public claim unavailable");
        return false;
      }
      // Claimed means possibly emitted, NOT confirmed Issue delivery. A crash or
      // lost ACK between this write and the exception cannot authorize a retry.
      const record: PublicClaimRecord = { version: 1,
        producerVersion: this.env.WORKER_METADATA.id, claimedAt: Date.now(),
        fixtureDigest: PUBLIC_FIXTURE_DIGEST };
      if (!validPublicClaim(record)) throw new Error("Owned public claim unavailable");
      await storage.put("public-http-emission-v1", record);
      return true;
    });
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}
/** Private read-only source corroboration; no emit/reset/model/writer methods.
 * The host separately pins version -> exact deployment source evidence. This
 * service does not claim to read the Issues occurrence API or attest source.
 */
export class PublicIncidentEvidence extends WorkerEntrypoint {
  async readPublicClaim() {
    const namespace = (
      this.ctx.exports as unknown as {
        PublicFailureClaim: DurableObjectNamespace<PublicFailureClaim>;
      }
    ).PublicFailureClaim;
    const r = await namespace.getByName(PUBLIC_EMISSION_ID).inspect();
    if ("state" in r) return { state: "absent" as const };
    return { emission: r.emission, version: r.version, currentVersion: r.currentVersion,
      fixtureDigest: r.fixtureDigest, claimedAt: r.claimedAt };
  }
  override fetch() { return new Response("Not found", { status: 404 }); }
}
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
  override fetch(request: Request) {
    if (!publicFailureEnabled)
      return new Response("Not found", { status: 404 });
    const namespace = (
      this.ctx.exports as unknown as {
        PublicFailureClaim: DurableObjectNamespace<PublicFailureClaim>;
      }
    ).PublicFailureClaim;
    return publicFaultFetch(request, namespace.getByName(PUBLIC_EMISSION_ID));
  }
}
