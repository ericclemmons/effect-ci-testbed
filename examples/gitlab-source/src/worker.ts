import * as CI from "@effect-ci-testbed/ci";
import * as Cloudflare from "@effect-ci-testbed/cloudflare";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import workflow from "../.cloudflare/ci/standalone.ts";
import { repository, revision, isPinnedSource } from "./reference.ts";
export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare";

export class GitLabSourceWorkflow extends WorkflowEntrypoint<{}, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    if (!isPinnedSource(event.payload)) throw new NonRetryableError("Exact pinned public GitLab source required");
    const binding = (this.ctx.exports as unknown as { WorkspaceContainer: DurableObjectNamespace }).WorkspaceContainer;
    const runner = Cloudflare.makeRunner({ binding, step, workspaceId: event.instanceId, repository, revision,
      container: { image: "workspace", instance: "standard-1" }, reuseWorkspace: false });
    const result = await CI.runPromise(workflow, { ci: true, env: "cloudflare", output: "silent", source: runner.source,
      actionExecutor: runner.actionExecutor, executor: runner.executor,
      workspaceFileSystem: runner.fileSystem, workspacePersistence: runner.persistence });
    return { repository, revision, verified: true, plan: result.plan };
  }
}
// Private native dispatch only. No token, clone or source-selection HTTP route.
export default { fetch: () => new Response("Not found", { status: 404 }) };
