import * as CI from "@effect-ci-testbed/ci"
import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as Effect from "effect/Effect"
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import { SourceRevisions, readDurableSource } from "../../../packages/cloudflare/src/durable-source.ts"
import workflow from "../../../examples/durable-object-source/.cloudflare/ci/workflow.ts"
export { SourceRevisions }

export const durableSourceManifest = new TextEncoder().encode(JSON.stringify({ version: 1, files: [
  { path: "source.txt", base64: btoa("source from durable object\n"), executable: false },
] }))
export const durableSourceId = "demo-source"

/** Only this fixed demo manifest can be seeded via authenticated native dispatch. */
export class DurableSourceWorkflow extends WorkflowEntrypoint<{}, Cloudflare.WorkflowParameters> {
  override async run(event: Readonly<WorkflowEvent<Cloudflare.WorkflowParameters>>, step: WorkflowStep) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", durableSourceManifest))
    const revision = Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("")
    if (event.payload.repository !== durableSourceId || event.payload.revision !== revision) throw new NonRetryableError("Fixed Durable Object source reference required")
    const host = this.ctx.exports as unknown as { WorkspaceContainer: DurableObjectNamespace; SourceRevisions: DurableObjectNamespace<SourceRevisions> }
    const storage = host.SourceRevisions.getByName(durableSourceId)
    await step.do("source:seed-fixed-manifest", async () => {
      const receipt = await storage.put(revision, durableSourceManifest)
      return { revision: receipt.revision, created: receipt.created }
    })
    const container = { image: "workspace", instance: "standard-1" } as const
    const runner = Cloudflare.makeRunner({ binding: host.WorkspaceContainer, step, workspaceId: event.instanceId,
      repository: durableSourceId, revision, container, reuseWorkspace: false })
    const source: CI.SourceService = {
      reference: { kind: "durable_object", id: durableSourceId, revision },
      checkout: () => Effect.tryPromise({ try: async () => {
        await step.do("source:durable-object", async () => {
          const files = await readDurableSource(storage, revision)
          const workspace = host.WorkspaceContainer.getByName(event.instanceId) as unknown as Cloudflare.WorkspaceContainer
          await workspace.materializeSource(files, container)
        })
        return CI.Workspace.remote(event.instanceId, "/workspace/repository")
      }, catch: error => error }),
    }
    return (await Effect.runPromise(Cloudflare.withWobsLogging(CI.run(workflow, { ci: true, env: "cloudflare", output: "silent", source,
      actionExecutor: runner.actionExecutor, executor: runner.executor,
      workspaceFileSystem: runner.fileSystem, workspacePersistence: runner.persistence }),
    { workflow: workflow.id, instance: event.instanceId }, this.env))).plan
  }
}
