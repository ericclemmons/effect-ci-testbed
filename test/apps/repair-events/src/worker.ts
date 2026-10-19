import {
  DurableObject,
  WorkerEntrypoint,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { inspection } from "./inspection.ts";
import { publicIncidentEnrollment } from "./public-enrollment.ts";
import { PublicIncidentActivations } from "./public-activation.ts";
export { PublicIncidentActivations, PublicIncidentAdmission } from "./public-activation.ts";
import {
  OWNED_INCIDENT,
  normalizeOwnedIncident,
  ownedIncidentIdentity,
  ownedAdmissionMode,
  type OwnedIncident,
} from "./owned-incident.ts";
import {
  authenticated,
  boundedBody,
  digest,
  MAX_BYTES,
  MAX_CAPTURES,
  notificationKind,
} from "./ingress.ts";
type Capture = {
  version: 1;
  digest: string;
  raw: string;
  receivedAt: number;
  quarantined: true;
  incidentDedupeVerified: false;
};
type SourceInspection = { PUBLIC_SOURCE?: { readPublicClaim(): Promise<unknown> } };
type Environment = { NOTIFICATIONS_SECRET: string } & SourceInspection;
const OWNER = "owned-issue-capture-v1";
const ADMISSION_KEY = "owned-semantic-incident-v1";
type Admission = { version: 1; identity: OwnedIncident; admittedAt: number };
function validAdmission(input: Admission | undefined): input is Admission {
  return (
    !!input &&
    input.version === 1 &&
    Number.isSafeInteger(input.admittedAt) &&
    input.admittedAt >= 0 &&
    JSON.stringify(input.identity) === JSON.stringify(ownedIncidentIdentity())
  );
}
export class NotificationCaptures extends DurableObject {
  async inspectOwnedIncident() {
    const stored = await this.ctx.storage.get<Admission>(ADMISSION_KEY);
    if (stored === undefined) return { state: "absent" as const };
    if (!validAdmission(stored))
      throw new Error("Owned incident storage unavailable");
    return {
      state: "admitted" as const,
      identity: { ...stored.identity },
      admittedAt: stored.admittedAt,
    };
  }
  async admitOwnedCapture(id: string) {
    // Caller cannot provide raw evidence, a version, repo, base, prompt or paid identity.
    // Capture provenance is the receiver's authenticated immutable store, not RPC claims.
    const captured = await this.read(id);
    const identity = normalizeOwnedIncident(captured.raw);
    return this.ctx.storage.transaction(async (storage) => {
      const old = await storage.get<Admission>(ADMISSION_KEY);
      if (old !== undefined) {
        if (!validAdmission(old))
          throw new Error("Owned incident storage unavailable");
        return {
          identity: { ...old.identity },
          admittedAt: old.admittedAt,
          duplicate: true,
          incidentDedupeVerified: true,
        };
      }
      const receipt: Admission = {
        version: 1,
        identity,
        admittedAt: Date.now(),
      };
      await storage.put(ADMISSION_KEY, receipt);
      // No side effect/inference follows this transaction. ACK uncertainty can safely
      // reconcile this SAME semantic record; this is not a paid-call retry mechanism.
      return {
        identity,
        admittedAt: receipt.admittedAt,
        duplicate: false,
        incidentDedupeVerified: true,
      };
    });
  }
  async capture(raw: string) {
    if (
      typeof raw !== "string" ||
      new TextEncoder().encode(raw).byteLength > MAX_BYTES ||
      notificationKind(raw) === "non-issue-text"
    )
      throw new Error("Notification capture rejected");
    const id = await digest(raw);
    return this.ctx.storage.transaction(async (storage) => {
      const ids = (await storage.get<string[]>("capture-index-v1")) ?? [];
      if (
        !Array.isArray(ids) ||
        ids.length > MAX_CAPTURES ||
        new Set(ids).size !== ids.length ||
        ids.some((v) => typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v))
      )
        throw new Error("Notification storage unavailable");
      if (ids.includes(id)) {
        const old = await storage.get<Capture>(`capture-v1:${id}`);
        if (
          !old ||
          old.version !== 1 ||
          old.digest !== id ||
          old.raw !== raw ||
          old.quarantined !== true
        )
          throw new Error("Notification storage unavailable");
        return { duplicate: true };
      }
      if (ids.length >= MAX_CAPTURES)
        throw new Error("Notification storage full");
      if ((await storage.get(`capture-v1:${id}`)) !== undefined)
        throw new Error("Notification storage unavailable");
      const receipt: Capture = {
        version: 1,
        digest: id,
        raw,
        receivedAt: Date.now(),
        quarantined: true,
        incidentDedupeVerified: false,
      };
      await storage.put(`capture-v1:${id}`, receipt);
      await storage.put("capture-index-v1", [...ids, id]);
      return { duplicate: false };
    });
  }
  async inventory() {
    const ids =
      (await this.ctx.storage.get<string[]>("capture-index-v1")) ?? [];
    if (
      !Array.isArray(ids) ||
      ids.length > MAX_CAPTURES ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
    )
      throw new Error("Notification storage unavailable");
    return [...ids];
  }
  async read(id: string) {
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
      throw new Error("Invalid capture identity");
    const receipt = await this.ctx.storage.get<Capture>(`capture-v1:${id}`);
    if (
      !receipt ||
      receipt.version !== 1 ||
      receipt.digest !== id ||
      typeof receipt.raw !== "string" ||
      new TextEncoder().encode(receipt.raw).byteLength > MAX_BYTES ||
      receipt.quarantined !== true ||
      receipt.incidentDedupeVerified !== false ||
      !Number.isSafeInteger(receipt.receivedAt) ||
      receipt.receivedAt < 0 ||
      (await digest(receipt.raw)) !== id
    )
      throw new Error("Capture unavailable");
    return { ...receipt };
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}
/** PRIVATE service-only read seam. Never reachable through the HTTP router. */
export class NotificationEvidence extends WorkerEntrypoint {
  private store() {
    return (
      this.ctx.exports as unknown as {
        NotificationCaptures: DurableObjectNamespace<NotificationCaptures>;
      }
    ).NotificationCaptures.getByName(OWNER);
  }
  async inventory(): Promise<string[]> {
    return [...(await this.store().inventory())];
  }
  async read(id: string): Promise<Capture> {
    const r = await this.store().read(id);
    return {
      version: 1,
      digest: r.digest,
      raw: r.raw,
      receivedAt: r.receivedAt,
      quarantined: true,
      incidentDedupeVerified: false,
    };
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}
/** Private host-owned policy capability. No public route or paid/writer binding. */
export class OwnedIncidentAdmission extends WorkerEntrypoint {
  private store() {
    return (
      this.ctx.exports as unknown as {
        NotificationCaptures: DurableObjectNamespace<NotificationCaptures>;
      }
    ).NotificationCaptures.getByName(OWNER);
  }
  async inspect() {
    const r = await this.store().inspectOwnedIncident();
    if (r.state === "absent") return { state: "absent" as const };
    return {
      state: "admitted" as const,
      identity: { ...r.identity },
      admittedAt: r.admittedAt,
    };
  }
  async admitRetained() {
    const r = await this.store().admitOwnedCapture(
      OWNED_INCIDENT.captureDigest,
    );
    return {
      identity: { ...r.identity },
      admittedAt: r.admittedAt,
      duplicate: r.duplicate,
      incidentDedupeVerified: true,
    };
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}
export class OwnedIncidentAdmissionWorkflow extends WorkflowEntrypoint<
  {},
  unknown
> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    try {
      const mode = ownedAdmissionMode(event.payload);
      return await step.do(
        `incident:${mode}`,
        { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" },
        async () => {
          const capability = (
            this.ctx.exports as unknown as {
              OwnedIncidentAdmission: (props: {}) => Service<OwnedIncidentAdmission>;
            }
          ).OwnedIncidentAdmission({});
          if (mode === "inspect") {
            const r = await capability.inspect();
            if (r.state === "absent") return { state: "absent" };
            return {
              state: "admitted",
              identity: { ...r.identity },
              admittedAt: r.admittedAt,
            };
          }
          const r = await capability.admitRetained();
          return {
            identity: { ...r.identity },
            admittedAt: r.admittedAt,
            duplicate: r.duplicate,
            incidentDedupeVerified: true,
          };
        },
      );
    } catch {
      throw new NonRetryableError("Owned incident admission unavailable");
    }
  }
}
/** Authenticated Workflow API ONLY. Public HTTP never dispatches this reader. */
export class NotificationInspectionWorkflow extends WorkflowEntrypoint<
  SourceInspection,
  unknown
> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    try {
      const request = inspection(event.payload);
      return await step.do(
        `notification:${request.mode}`,
        { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" },
        async () => {
          if (request.mode === "public-source") {
            // Read the SAME fixed private claim after a failed admission. No
            // event replay, outbox mutation, new identity or paid dispatch.
            if (!this.env.PUBLIC_SOURCE) throw new Error("Private source not configured");
            const r = await this.env.PUBLIC_SOURCE.readPublicClaim() as Record<string, unknown>;
            if (r.state === "absent") return { state: "absent", readOnly: true };
            if (typeof r.emission !== "string" || typeof r.version !== "string" ||
                typeof r.currentVersion !== "string" || typeof r.fixtureDigest !== "string" ||
                !Number.isSafeInteger(r.claimedAt)) throw new Error("Private source receipt unavailable");
            return { producer: { emission: r.emission, version: r.version,
              currentVersion: r.currentVersion, fixtureDigest: r.fixtureDigest,
              claimedAt: r.claimedAt as number }, readOnly: true, inferenceCalled: false };
          }
          const evidence = (
            this.ctx.exports as unknown as {
              NotificationEvidence: (props: {}) => Service<NotificationEvidence>;
            }
          ).NotificationEvidence({});
          if (request.mode === "inventory")
            return {
              digests: [...(await evidence.inventory())],
              quarantined: true,
              incidentDedupeVerified: false,
            };
          const result = await evidence.read(request.digest);
          return {
            version: 1,
            digest: result.digest,
            raw: result.raw,
            receivedAt: result.receivedAt,
            quarantined: true,
            incidentDedupeVerified: false,
          };
        },
      );
    } catch {
      throw new NonRetryableError("Notification inspection unavailable");
    }
  }
}
export default class NotificationReceiver extends WorkerEntrypoint<Environment> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/notifications" || url.search)
      return new Response("Not found", { status: 404 });
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    if (
      !(await authenticated(
        request.headers.get("cf-webhook-auth"),
        this.env.NOTIFICATIONS_SECRET,
      ))
    )
      return new Response("Unauthorized", { status: 401 });
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      return new Response("Invalid notification", { status: 400 });
    try {
      const raw = await boundedBody(request);
      if (notificationKind(raw) === "non-issue-text")
        return new Response(null, { status: 204 });
      const namespace = (
        this.ctx.exports as unknown as {
          NotificationCaptures: DurableObjectNamespace<NotificationCaptures>;
        }
      ).NotificationCaptures;
      await namespace.getByName(OWNER).capture(raw);
      if (publicIncidentEnrollment !== undefined) {
        const activations = (
          this.ctx.exports as unknown as {
            PublicIncidentActivations: DurableObjectNamespace<PublicIncidentActivations>;
          }
        ).PublicIncidentActivations;
        // Normal authenticated delivery, not an operator Workflow dispatch.
        // One permanent slot for the enrolled public source, not per delivery.
        await activations.getByName("owned-public-incident-v1").activate(await digest(raw));
      }
      // No body, digest, receipt, account metadata or secret returned publicly.
      return new Response(null, { status: 202 });
    } catch {
      return new Response("Notification unavailable", { status: 503 });
    }
  }
}
