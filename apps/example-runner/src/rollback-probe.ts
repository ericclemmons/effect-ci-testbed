import * as CI from "@effect-ci-testbed/ci"
import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as Effect from "effect/Effect"
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import workflow from "../../../examples/rollback-compensation/.cloudflare/ci/workflow.ts"

// Failure injection belongs only to this authenticated test host. The consumer
// workflow and its rollback policy remain unchanged; no deployment occurs.
export class RollbackExhaustionWorkflow extends WorkflowEntrypoint<Cloudflare.WorkflowEnvironment, Cloudflare.WorkflowParameters> {
  override async run(event: Readonly<WorkflowEvent<Cloudflare.WorkflowParameters>>, step: WorkflowStep) {
    const binding = this.env.Workspace ?? (this.ctx.exports as unknown as {
      WorkspaceContainer: DurableObjectNamespace
    }).WorkspaceContainer
    const runner = Cloudflare.makeRunner({
      binding, step, workspaceId: event.instanceId,
      repository: event.payload.repository, revision: event.payload.revision,
      root: "examples/rollback-compensation", reuseWorkspace: false,
    })
    const result = await CI.runPromise(workflow, {
      ci: true, env: "cloudflare", output: "silent",
      source: runner.source, actionExecutor: runner.actionExecutor,
      workspaceFileSystem: runner.fileSystem, workspacePersistence: runner.persistence,
      executor: {
        handlesStepOptions: true,
        execute: (request) => runner.executor.execute({
          ...request,
          command: request.command === "echo deploy"
            ? "echo expected-deployment-failure >&2; exit 7"
            : request.command,
        }),
      },
    })
    return result.plan
  }
}

const rollbackFirst = CI.action<string>("rollback first", () => () => Effect.succeed("first reverted"), { timeout: 1000 })
const first = CI.action<string>("release first", () => () => Effect.succeed("first released"), { timeout: 1000, rollback: rollbackFirst })
const rollbackSecond = CI.action<string>("rollback second", () => () => Effect.succeed("second reverted"), { timeout: 1000 })
const second = CI.action<string>("release second", function* () {
  yield* first()
  return () => Effect.succeed("second released")
}, { timeout: 1000, rollback: rollbackSecond })
const health = CI.action<void>("health gate", function* () {
  yield* second()
  return () => Effect.fail(new Error("expected-health-regression"))
}, { retries: { limit: 1, delay: 0 } })

export const reverseRollbackProbe = CI.workflow("reverse-rollback", () => health())
