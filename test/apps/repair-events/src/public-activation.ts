import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import {
  admitPublicIncident, dispatchPublicIncident, readPublicIncidentOutbox,
  type PublicIncidentOutbox,
} from "../../../../packages/github/src/public-incident.ts";
import { publicIncidentEnrollment } from "./public-enrollment.ts";
import type { NotificationCaptures } from "./worker.ts";

export interface PublicActivationEnvironment {
  PUBLIC_SOURCE?: { readPublicClaim(): Promise<unknown> };
  PUBLIC_REPAIR?: { trigger(event: { type: "observability_issue"; admissionId: string }): Promise<{ id: string }> };
}
const key = "public-incident-outbox-v1";
const rejected = () => new Error("Public incident outbox unavailable; inspect before recovery");

/** Private host-selected singleton, separate from the completed old admission.
 * Caller supplies only an existing authenticated capture digest. No raw object,
 * policy, source, prompt, destination or paid-operation identity is an argument.
 */
export class PublicIncidentActivations extends DurableObject<PublicActivationEnvironment> {
  async inspect() {
    const raw = await this.ctx.storage.get(key);
    if (raw === undefined) return { state: "absent" as const };
    const record = await readPublicIncidentOutbox(raw);
    return { state: record.state, instance: record.instance };
  }
  async readAdmission(instance: string) {
    if (!publicIncidentEnrollment) throw rejected();
    const record = await readPublicIncidentOutbox(await this.ctx.storage.get(key));
    if (record.instance !== instance) throw rejected();
    return { instance: record.instance, admission: { ...record.admission } };
  }
  async activate(captureDigest: string) {
    const policy = publicIncidentEnrollment;
    if (!policy || !this.env.PUBLIC_SOURCE || !this.env.PUBLIC_REPAIR)
      throw rejected();
    const captures = (
      this.ctx.exports as unknown as {
        NotificationCaptures: DurableObjectNamespace<NotificationCaptures>;
      }
    ).NotificationCaptures.getByName("owned-issue-capture-v1");
    const captured = await captures.read(captureDigest);
    const value = await this.env.PUBLIC_SOURCE.readPublicClaim() as Record<string, unknown>;
    // RPC wrappers are not schema values. Explicit copy before descriptor-safe
    // validation, never spread/enumerate a binding wrapper or notification.
    const proof = {
      emission: value?.emission, version: value?.version,
      currentVersion: value?.currentVersion, fixtureDigest: value?.fixtureDigest,
      claimedAt: value?.claimedAt,
    };
    const admission = admitPublicIncident(captured.raw, proof, policy, Date.now());
    return dispatchPublicIncident({
      read: () => this.ctx.storage.get(key),
      claim: record => this.ctx.storage.transaction(async storage => {
        if (await storage.get(key) !== undefined) return false;
        await storage.put(key, record);
        return true;
      }),
      acknowledge: digest => this.ctx.storage.transaction(async storage => {
        const current = await storage.get<PublicIncidentOutbox>(key);
        if (current?.version !== 1 || current.state !== "dispatching" || current.digest !== digest)
          throw rejected();
        await storage.put(key, { ...current, state: "dispatched" });
      }),
    }, admission, async instance => {
      const ack = await this.env.PUBLIC_REPAIR!.trigger({ type: "observability_issue", admissionId: instance });
      return { id: ack.id };
    });
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}

/** Read-only service for the future fixed repair Workflow. It cannot dispatch,
 * admit raw evidence, choose a fixture, reset an operation or call a model.
 */
export class PublicIncidentAdmission extends WorkerEntrypoint {
  async publicActivationState() {
    const namespace = (this.ctx.exports as unknown as {
      PublicIncidentActivations: DurableObjectNamespace<PublicIncidentActivations>;
    }).PublicIncidentActivations;
    const r = await namespace.getByName("owned-public-incident-v1").inspect();
    return r.state === "absent" ? { state: r.state } : { state: r.state, instance: r.instance };
  }
  async publicEnrollmentReadiness(version: string) {
    const p = publicIncidentEnrollment;
    if (!p || p.version !== version) throw rejected();
    return { policy: p.policy, service: p.service, source: p.source, version: p.version,
      emission: p.emission, fixtureDigest: p.fixtureDigest };
  }
  async readPublicAdmission(instance: string) {
    const namespace = (
      this.ctx.exports as unknown as {
        PublicIncidentActivations: DurableObjectNamespace<PublicIncidentActivations>;
      }
    ).PublicIncidentActivations;
    const result = await namespace.getByName("owned-public-incident-v1").readAdmission(instance);
    const r = result.admission;
    return { instance: result.instance, admission: {
      policy: r.policy, issue: r.issue, correlation: r.correlation, service: r.service,
      source: r.source, version: r.version, emission: r.emission,
      fixtureDigest: r.fixtureDigest, claimedAt: r.claimedAt, observedAt: r.observedAt,
    } };
  }
  override fetch() { return new Response("Not found", { status: 404 }); }
}
