import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { readArtifactSource } from "../../../packages/cloudflare/src/artifacts-source.ts"
import workflow from "../../../examples/source-providers/.cloudflare/ci/workflow.ts"

export class ArtifactsSourceWorkflow extends WorkflowEntrypoint<{ ARTIFACTS: Artifacts }, Cloudflare.WorkflowParameters> {
  override async run(event: Readonly<WorkflowEvent<Cloudflare.WorkflowParameters>>, step: WorkflowStep) {
    const binding = (this.ctx.exports as unknown as { WorkspaceContainer: DurableObjectNamespace }).WorkspaceContainer
    const container = { image: "workspace", instance: "standard-1" } as const
    const runner = Cloudflare.makeRunner({ binding, step, workspaceId: event.instanceId,
      repository: event.payload.repository, revision: event.payload.revision, container, reuseWorkspace: false })
    const source: CI.SourceService = {
      reference: { kind: "artifact", name: event.payload.repository, digest: event.payload.revision },
      checkout: () => Effect.tryPromise({
        try: async () => {
          await step.do("source:artifacts", async () => {
            using repo = await this.env.ARTIFACTS.get(event.payload.repository)
            const files = await readArtifactSource(repo, event.payload.revision, "examples/source-providers")
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
