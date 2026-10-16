import * as Cloudflare from "@effect-ci-testbed/cloudflare";
import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { readR2Source } from "@effect-ci-testbed/cloudflare/r2-source";
import workflow from "../.cloudflare/ci/standalone.ts";
import { sourceParameters } from "./parameters.ts";

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare";
export class R2SourceWorkflow extends WorkflowEntrypoint<{ SOURCE_BUCKET: R2Bucket }, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    let parameters;
    try { parameters = sourceParameters(event.payload); }
    catch { throw new NonRetryableError("Exact R2 source parameters required"); }
    const binding = (this.ctx.exports as unknown as { WorkspaceContainer: DurableObjectNamespace }).WorkspaceContainer;
    const container = { image: "workspace", instance: "standard-1" } as const;
    const runner = Cloudflare.makeRunner({ binding, step, workspaceId: event.instanceId,
      repository: parameters.repository, revision: parameters.revision, container, reuseWorkspace: false });
    const source: CI.SourceService = {
      reference: { kind: "r2", bucket: "effect-ci-r2-source-input", key: parameters.repository, digest: parameters.revision },
      checkout: () => Effect.tryPromise({ try: async () => {
        await step.do("source:r2", { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" }, async () => {
          const files = await readR2Source(this.env.SOURCE_BUCKET, parameters.repository, parameters.revision);
          const workspace = binding.getByName(event.instanceId) as unknown as Cloudflare.WorkspaceContainer;
          await workspace.materializeSource(files, container);
          return { key: parameters.repository, digest: parameters.revision, files: files.length };
        });
        return CI.Workspace.remote(event.instanceId, "/workspace/repository");
      }, catch: error => error }),
    };
    const result = await CI.runPromise(workflow, { ci: true, env: "cloudflare", output: "silent", source,
      actionExecutor: runner.actionExecutor, executor: runner.executor,
      workspaceFileSystem: runner.fileSystem, workspacePersistence: runner.persistence });
    return { source: { bucket: "effect-ci-r2-source-input", key: parameters.repository, digest: parameters.revision },
      plan: result.plan, verified: true, storageCredentialsGivenToContainer: false };
  }
}
// No public source reader, writer, execution endpoint or credential route.
export default { fetch: () => new Response("Not found", { status: 404 }) };
