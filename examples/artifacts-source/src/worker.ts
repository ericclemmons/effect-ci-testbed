import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import { readArtifactSource } from "@effect-ci-testbed/cloudflare/artifacts-source"
import workflow from "../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

interface Parameters {
  readonly repository: string
  readonly revision: string
  /** Directory in the imported repository containing this example's source.txt. */
  readonly directory?: string
}

export class ArtifactsSourceWorkflow extends WorkflowEntrypoint<{ ARTIFACTS: Artifacts }, Parameters> {
  override async run(event: Readonly<WorkflowEvent<Parameters>>, step: WorkflowStep) {
    if (!event.payload || typeof event.payload.repository !== "string" || !/^[\w.-]{1,128}$/.test(event.payload.repository)
      || typeof event.payload.revision !== "string" || !/^[a-f0-9]{40}$/.test(event.payload.revision)) {
      throw new NonRetryableError("An Artifacts repository name and full immutable commit SHA are required")
    }
    const directory = event.payload.directory ?? ""
    if (typeof directory !== "string" || (directory !== "" && !directory.split("/").every(segment => /^[\w.-]+$/.test(segment) && segment !== "." && segment !== ".."))) {
      throw new NonRetryableError("A safe source directory is required")
    }
    const binding = (this.ctx.exports as unknown as { WorkspaceContainer: DurableObjectNamespace }).WorkspaceContainer
    const container = { image: "workspace", instance: "standard-1" } as const
    const runner = Cloudflare.makeRunner({ binding, step, workspaceId: event.instanceId,
      repository: event.payload.repository, revision: event.payload.revision, container, reuseWorkspace: false })
    const source: CI.SourceService = {
      reference: { kind: "artifact", name: event.payload.repository, digest: event.payload.revision },
      checkout: () => Effect.tryPromise(async () => {
        await step.do("source:artifacts", async () => {
          using repo = await this.env.ARTIFACTS.get(event.payload.repository)
          const files = await readArtifactSource(repo, event.payload.revision, directory)
          const workspace = binding.getByName(event.instanceId) as unknown as Cloudflare.WorkspaceContainer
          await workspace.materializeSource(files, container)
        })
        return CI.Workspace.remote(event.instanceId, "/workspace/repository")
      }),
    }
    return (await CI.runPromise(workflow, { ci: true, env: "cloudflare", output: "silent", source,
      actionExecutor: runner.actionExecutor, executor: runner.executor,
      workspaceFileSystem: runner.fileSystem, workspacePersistence: runner.persistence })).plan
  }
}

// Native Workflow dispatch requires Cloudflare account authorization, not a public POST route.
export default { fetch: () => new Response("Not found", { status: 404 }) }
