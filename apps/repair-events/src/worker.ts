import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
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
type Environment = { NOTIFICATIONS_SECRET: string };
const OWNER = "owned-issue-capture-v1";
export class NotificationCaptures extends DurableObject {
  async capture(raw: string) {
    if (
      typeof raw !== "string" ||
      new TextEncoder().encode(raw).byteLength > MAX_BYTES ||
      notificationKind(raw) !== "quarantine"
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
      if (notificationKind(raw) === "test")
        return new Response(null, { status: 204 });
      const namespace = (
        this.ctx.exports as unknown as {
          NotificationCaptures: DurableObjectNamespace<NotificationCaptures>;
        }
      ).NotificationCaptures;
      await namespace.getByName(OWNER).capture(raw);
      // No body, digest, receipt, account metadata or secret returned publicly.
      return new Response(null, { status: 202 });
    } catch {
      return new Response("Notification unavailable", { status: 503 });
    }
  }
}
