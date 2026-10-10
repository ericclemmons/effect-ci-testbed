import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { readR2Source } from "../../../packages/cloudflare/src/r2-source.ts"
import workflow from "../../../examples/r2-source/.cloudflare/ci/workflow.ts"

export class R2SourceWorkflow extends WorkflowEntrypoint<{ SOURCE_BUCKET: R2Bucket }, Cloudflare.WorkflowParameters> {
  override async run(event: Readonly<WorkflowEvent<Cloudflare.WorkflowParameters>>, step: WorkflowStep) {
    const binding = (this.ctx.exports as unknown as { WorkspaceContainer: DurableObjectNamespace }).WorkspaceContainer
    const container = { image: "workspace", instance: "standard-1" } as const
    const runner = Cloudflare.makeRunner({ binding, step, workspaceId: event.instanceId,
      repository: event.payload.repository, revision: event.payload.revision, container, reuseWorkspace: false })
    const source: CI.SourceService = {
      reference: { kind: "r2", bucket: "effect-ci-example-source", key: event.payload.repository, digest: event.payload.revision },
      checkout: () => Effect.tryPromise({
        try: async () => {
          await step.do("source:r2", async () => {
            const files = await readR2Source(this.env.SOURCE_BUCKET, event.payload.repository, event.payload.revision)
            const workspace = binding.getByName(event.instanceId) as unknown as Cloudflare.WorkspaceContainer
            await workspace.materializeSource(files, container)
          })
          return CI.Workspace.remote(event.instanceId, "/workspace/repository")
        }, catch: (error) => error,
      }),
    }
    return (await CI.runPromise(workflow, { ci: true, env: "cloudflare", output: "silent", source,
      actionExecutor: runner.actionExecutor, executor: runner.executor,
      workspaceFileSystem: runner.fileSystem, workspacePersistence: runner.persistence })).plan
  }
}
