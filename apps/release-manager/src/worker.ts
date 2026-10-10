import { DurableObject, WorkerEntrypoint } from "cloudflare:workers"
import { ReleaseManager, deploymentAPI, RELEASE_SCRIPT, type ReleaseJournal } from "./release-manager.ts"

interface Environment { HMD_DEPLOY_TOKEN: string }

/** One durable owner/journal for the one fixed target, independent of Workflow lifetime. */
export class ReleaseJournalObject extends DurableObject<Environment> {
  private queue: Promise<unknown> = Promise.resolve()
  private run(operation: (manager: ReleaseManager) => Promise<ReleaseJournal>) {
    const result = this.queue.then(async () => {
      if (!this.env.HMD_DEPLOY_TOKEN) throw new Error("Release broker credential is not configured")
      const manager = new ReleaseManager({
        read: () => this.ctx.storage.get<ReleaseJournal>("release"),
        write: (value) => this.ctx.storage.put("release", value),
      }, deploymentAPI(() => this.env.HMD_DEPLOY_TOKEN))
      return operation(manager)
    })
    this.queue = result.catch(() => undefined)
    return result
  }
  begin(owner: string, candidate: string) { return this.run((manager) => manager.begin(owner, candidate)) }
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
  begin(owner: string, candidate: string) { return this.journal().begin(owner, candidate) }
  promote(owner: string, percentage: number) { return this.journal().promote(owner, percentage) }
  rollback(owner: string) { return this.journal().rollback(owner) }
  reconcile(owner: string) { return this.journal().reconcile(owner) }
  complete(owner: string) { return this.journal().complete(owner) }
  override fetch() { return new Response("Not found", { status: 404 }) }
}
