import * as CI from "@effect-ci-testbed/ci"
import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as Effect from "effect/Effect"
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import workflow from "../../../examples/gitlab-source/.cloudflare/ci/workflow.ts"

export const gitlabRepository = "https://gitlab.com/gitlab-org/gitlab-test.git"
export const gitlabRevision = "ddd0f15ae83993f5cb66a927a28673882e99100b"

/** Public clone lab; no GitHub token or other credentials are provided to Git. */
export class GitLabSourceWorkflow extends WorkflowEntrypoint<{}, Cloudflare.WorkflowParameters> {
  override async run(event: Readonly<WorkflowEvent<Cloudflare.WorkflowParameters>>, step: WorkflowStep) {
    if (event.payload.repository !== gitlabRepository || event.payload.revision !== gitlabRevision) throw new NonRetryableError("Pinned public GitLab source required")
    const binding = (this.ctx.exports as unknown as { WorkspaceContainer: DurableObjectNamespace }).WorkspaceContainer
    const runner = Cloudflare.makeRunner({ binding, step, workspaceId: event.instanceId,
      repository: gitlabRepository, revision: gitlabRevision,
      container: { image: "workspace", instance: "standard-1" }, reuseWorkspace: false })
    return (await Effect.runPromise(Cloudflare.withWobsLogging(CI.run(workflow, { ci: true, env: "cloudflare", output: "silent", source: runner.source,
      actionExecutor: runner.actionExecutor, executor: runner.executor,
      workspaceFileSystem: runner.fileSystem, workspacePersistence: runner.persistence }),
    { workflow: workflow.id, instance: event.instanceId }, this.env))).plan
  }
}
