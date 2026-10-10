import { DurableObject, WorkerEntrypoint } from "cloudflare:workers"
import { ReleaseManager, deploymentAPI, RELEASE_SCRIPT, type ReleaseJournal } from "./release-manager.ts"

interface Environment { HMD_DEPLOY_TOKEN: string }

/** One durable owner/journal for the one fixed target, independent of Workflow lifetime. */
export class ReleaseJournalObject extends DurableObject<Environment> {
  private queue: Promise<unknown> = Promise.resolve()
  private run<T>(operation: (manager: ReleaseManager) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      if (!this.env.HMD_DEPLOY_TOKEN) throw new Error("Release broker credential is not configured")
      const manager = new ReleaseManager({
        read: () => this.ctx.storage.get<ReleaseJournal>("release"),
        write: (value) => this.ctx.storage.transaction(async (storage) => {
          // Journal and wakeup commit together BEFORE any deployment write.
          await storage.put("release", value)
          if (value.status === "active" && value.expiresAt !== undefined) await storage.setAlarm(value.expiresAt)
          else await storage.deleteAlarm()
        }),
      }, deploymentAPI(() => this.env.HMD_DEPLOY_TOKEN))
      return operation(manager)
    })
    this.queue = result.catch(() => undefined)
    return result
  }
  begin(owner: string, candidate: string, leaseSeconds?: number) { return this.run((manager) => manager.begin(owner, candidate, leaseSeconds)) }
  renew(owner: string) { return this.run((manager) => manager.renew(owner)) }
  override async alarm() {
    await this.run(async (manager) => {
      try {
        await manager.recoverExpired()
        const current = await this.ctx.storage.get<ReleaseJournal>("release")
        // A stale wakeup must not consume the newly renewed deadline.
        if (current?.status === "active" && current.expiresAt !== undefined) await this.ctx.storage.setAlarm(current.expiresAt)
      } catch {
        // Serialized with renew/begin: never clobber a different owner's alarm.
        // Keep pending intent. Retry reconciliation, never blindly repeat POST.
        await this.ctx.storage.setAlarm(Date.now() + 60_000)
        console.error("Release recovery needs reconciliation or operator review")
      }
    })
  }
  promote(owner: string, percentage: number) { return this.run((manager) => manager.promote(owner, percentage)) }
  rollback(owner: string) { return this.run((manager) => manager.rollback(owner)) }
  reconcile(owner: string) { return this.run((manager) => manager.reconcile(owner)) }
  complete(owner: string) { return this.run((manager) => manager.complete(owner)) }
  override fetch() { return new Response("Not found", { status: 404 }) }
}

/** Service-binding RPC only. No HTTP administration, token getter, arbitrary URL or script. */
export default class ReleaseManagerWorker extends WorkerEntrypoint<Environment> {
  private journal() {
    const binding = (this.ctx.exports as unknown as { ReleaseJournalObject: DurableObjectNamespace<ReleaseJournalObject> }).ReleaseJournalObject
    return binding.getByName(RELEASE_SCRIPT)
  }
  begin(owner: string, candidate: string, leaseSeconds?: number) { return this.journal().begin(owner, candidate, leaseSeconds) }
  renew(owner: string) { return this.journal().renew(owner) }
  promote(owner: string, percentage: number) { return this.journal().promote(owner, percentage) }
  rollback(owner: string) { return this.journal().rollback(owner) }
  reconcile(owner: string) { return this.journal().reconcile(owner) }
  complete(owner: string) { return this.journal().complete(owner) }
  override fetch() { return new Response("Not found", { status: 404 }) }
}
