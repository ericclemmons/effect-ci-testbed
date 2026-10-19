import {
  DurableObject,
  WorkerEntrypoint,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { siteRevision } from "@effect-ci-testbed/cloudflare/demo-site";
import {
  ReleaseManager,
  deploymentAPI,
  RELEASE_SCRIPT,
  type ReleaseJournal,
} from "./release-manager.ts";
import {
  prepareCandidate,
  reconcileCandidate,
  type CandidateRecord,
  type CandidateReceipt,
} from "./candidate.ts";

interface Environment {
  HMD_DEPLOY_TOKEN: string;
}
// Match the immutable preview registry's finite retention window. Never evict
// a pending claim or a completed receipt merely to admit a new release.
export const candidateCapacity = 256;

/** One durable owner/journal for the one fixed target, independent of Workflow lifetime. */
export class ReleaseJournalObject extends DurableObject<Environment> {
  async inspectCandidate(revision: string) {
    const exact = siteRevision(revision);
    const index = (await this.ctx.storage.get<string[]>("candidate-index-v1")) ?? [];
    const candidate = await this.ctx.storage.get<CandidateRecord>(`candidate:${exact}`);
    const release = await this.ctx.storage.get<ReleaseJournal>("release");
    // Read-only metadata. No token, assets, arbitrary storage key or reset.
    return {
      revision: exact,
      count: index.length,
      capacity: candidateCapacity,
      present: candidate !== undefined,
      status: candidate?.status ?? "absent",
      releaseStatus: release?.status ?? "absent",
      pendingRelease: Boolean(release?.pending),
    };
  }
  private queue: Promise<unknown> = Promise.resolve();
  private run<T>(operation: (manager: ReleaseManager) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      if (!this.env.HMD_DEPLOY_TOKEN)
        throw new Error("Release broker credential is not configured");
      const manager = new ReleaseManager(
        {
          read: () => this.ctx.storage.get<ReleaseJournal>("release"),
          write: (value) =>
            this.ctx.storage.transaction(async (storage) => {
              // Journal and wakeup commit together BEFORE any deployment write.
              await storage.put("release", value);
              if (value.status === "active" && value.expiresAt !== undefined)
                await storage.setAlarm(value.expiresAt);
              else await storage.deleteAlarm();
            }),
        },
        deploymentAPI(() => this.env.HMD_DEPLOY_TOKEN),
      );
      return operation(manager);
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
  begin(owner: string, candidate: string, leaseSeconds?: number) {
    return this.run((manager) => manager.begin(owner, candidate, leaseSeconds));
  }
  prepareCandidate(revision: string, digest: string): Promise<CandidateReceipt> {
    return this.run(async () => {
      const release = await this.ctx.storage.get<ReleaseJournal>("release");
      if (release?.status === "active" || release?.pending)
        throw new Error("A release owns the target; preparation is blocked");
      return prepareCandidate(
        {
          read: (revision) => this.ctx.storage.get<CandidateRecord>(`candidate:${revision}`),
          claim: (record) =>
            this.ctx.storage.transaction(async (storage) => {
              if (await storage.get(`candidate:${record.revision}`))
                throw new Error("Candidate already claimed");
              const index = (await storage.get<string[]>("candidate-index-v1")) ?? [];
              if (index.length >= candidateCapacity) throw new Error("Candidate capacity reached");
              await storage.put(`candidate:${record.revision}`, record);
              await storage.put("candidate-index-v1", [...index, record.revision]);
            }),
          complete: (record) =>
            this.ctx.storage.transaction(async (storage) => {
              const previous = await storage.get<CandidateRecord>(`candidate:${record.revision}`);
              if (
                previous?.status !== "pending" ||
                previous.digest !== record.digest ||
                previous.moduleDigest !== record.moduleDigest ||
                previous.policy !== record.policy
              )
                throw new Error("Candidate completion conflict");
              await storage.put(`candidate:${record.revision}`, record);
            }),
        },
        revision,
        digest,
        () => this.env.HMD_DEPLOY_TOKEN,
      );
    });
  }
  renew(owner: string) {
    return this.run((manager) => manager.renew(owner));
  }
  reconcileCandidate(revision: string, digest: string, version: string): Promise<CandidateReceipt> {
    return this.run(async () => {
      const release = await this.ctx.storage.get<ReleaseJournal>("release");
      if (release?.status === "active" || release?.pending)
        throw new Error("A release owns the target; reconciliation is blocked");
      return reconcileCandidate(
        {
          read: (revision) => this.ctx.storage.get<CandidateRecord>(`candidate:${revision}`),
          claim: async () => {
            throw new Error("Reconciliation cannot create a claim");
          },
          complete: (record) =>
            this.ctx.storage.transaction(async (storage) => {
              const previous = await storage.get<CandidateRecord>(`candidate:${record.revision}`);
              if (
                previous?.status !== "pending" ||
                previous.digest !== record.digest ||
                previous.moduleDigest !== record.moduleDigest ||
                previous.policy !== record.policy
              )
                throw new Error("Candidate completion conflict");
              await storage.put(`candidate:${record.revision}`, record);
            }),
        },
        revision,
        digest,
        version,
        () => this.env.HMD_DEPLOY_TOKEN,
      );
    });
  }
  override async alarm() {
    await this.run(async (manager) => {
      try {
        await manager.recoverExpired();
        const current = await this.ctx.storage.get<ReleaseJournal>("release");
        // A stale wakeup must not consume the newly renewed deadline.
        if (current?.status === "active" && current.expiresAt !== undefined)
          await this.ctx.storage.setAlarm(current.expiresAt);
      } catch {
        // Serialized with renew/begin: never clobber a different owner's alarm.
        // Keep pending intent. Retry reconciliation, never blindly repeat POST.
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
        console.error("Release recovery needs reconciliation or operator review");
      }
    });
  }
  promote(owner: string, percentage: number) {
    return this.run((manager) => manager.promote(owner, percentage));
  }
  rollback(owner: string) {
    return this.run((manager) => manager.rollback(owner));
  }
  reconcile(owner: string) {
    return this.run((manager) => manager.reconcile(owner));
  }
  complete(owner: string) {
    return this.run((manager) => manager.complete(owner));
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}

/** Authenticated native API only. A fixed metadata read, never prepare/retry. */
export class CandidateInspectionWorkflow extends WorkflowEntrypoint<unknown, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    if (
      !event.payload ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload) ||
      Reflect.ownKeys(event.payload).length
    )
      throw new NonRetryableError("Empty inspection payload required");
    return step.do(
      "candidate:read-metadata",
      { retries: { limit: 0, delay: "1 second" }, timeout: "15 seconds" },
      async () => {
        const namespace = (
          this.ctx.exports as unknown as {
            ReleaseJournalObject: DurableObjectNamespace<ReleaseJournalObject>;
          }
        ).ReleaseJournalObject;
        const journal = namespace.getByName(RELEASE_SCRIPT);
        const results = [];
        for (const revision of [
          "030c9f540e0906bea570380d208b8e7473a502ae",
          "a39a6801acb2818e2df9877dd2293c91c28325ed",
        ]) {
          const value = await journal.inspectCandidate(revision);
          results.push({
            revision: value.revision,
            count: value.count,
            capacity: value.capacity,
            present: value.present,
            status: value.status,
            releaseStatus: value.releaseStatus,
            pendingRelease: value.pendingRelease,
          });
          (value as unknown as Disposable)[Symbol.dispose]?.();
        }
        return results;
      },
    );
  }
}

/** Service-binding RPC only. No HTTP administration, token getter, arbitrary URL or script. */
export default class ReleaseManagerWorker extends WorkerEntrypoint<Environment> {
  private journal() {
    const binding = (
      this.ctx.exports as unknown as {
        ReleaseJournalObject: DurableObjectNamespace<ReleaseJournalObject>;
      }
    ).ReleaseJournalObject;
    return binding.getByName(RELEASE_SCRIPT);
  }
  begin(owner: string, candidate: string, leaseSeconds?: number) {
    return this.journal().begin(owner, candidate, leaseSeconds);
  }
  prepareCandidate(revision: string, digest: string): Promise<CandidateReceipt> {
    return this.journal().prepareCandidate(revision, digest);
  }
  reconcileCandidate(revision: string, digest: string, version: string): Promise<CandidateReceipt> {
    return this.journal().reconcileCandidate(revision, digest, version);
  }
  renew(owner: string) {
    return this.journal().renew(owner);
  }
  promote(owner: string, percentage: number) {
    return this.journal().promote(owner, percentage);
  }
  rollback(owner: string) {
    return this.journal().rollback(owner);
  }
  reconcile(owner: string) {
    return this.journal().reconcile(owner);
  }
  complete(owner: string) {
    return this.journal().complete(owner);
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}
