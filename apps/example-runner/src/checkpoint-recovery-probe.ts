import * as CI from "@effect-ci-testbed/ci"
import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as Effect from "effect/Effect"
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout()
})
const recover = CI.action("recoverable workspace", function* () {
  const workspace = yield* checkout()
  return () => Effect.gen(function* () {
    const attempt = yield* CI.Attempt
    yield* workspace.exec("test -f README.md")
    return yield* workspace.exec(`printf attempt-${attempt} > .checkpoint-result`)
  })
}, { retries: { limit: 1, delay: 0 } })
const verify = CI.check("verify recovery", () => function* () {
  const workspace = yield* recover()
  yield* workspace.exec('test "$(cat .checkpoint-result)" = attempt-2 && echo recovery-verified')
})
const workflow = CI.workflow("checkpoint-recovery-probe", () => verify())

// Controlled fault injection, only in the authenticated example host. Replacing
// the live container with its input snapshot discards the first attempt's files.
// The policy must recompute them before publishing any successful native result.
export class CheckpointRecoveryWorkflow extends WorkflowEntrypoint<Cloudflare.WorkflowEnvironment, Cloudflare.WorkflowParameters> {
  override async run(event: Readonly<WorkflowEvent<Cloudflare.WorkflowParameters>>, step: WorkflowStep) {
    const binding = this.env.Workspace ?? (this.ctx.exports as unknown as {
      WorkspaceContainer: DurableObjectNamespace
    }).WorkspaceContainer
    const runner = Cloudflare.makeRunner({
      binding, step, workspaceId: event.instanceId,
      repository: event.payload.repository, revision: event.payload.revision,
      container: { image: "workspace", instance: "standard-1" }, reuseWorkspace: false,
    })
    const result = await CI.runPromise(workflow, {
      ci: true, env: "cloudflare", output: "silent",
      source: runner.source, actionExecutor: runner.actionExecutor,
      executor: runner.executor, workspaceFileSystem: runner.fileSystem,
      workspacePersistence: {
        ...runner.persistence,
        commit: (request) => Effect.gen(function* () {
          const marker = request.stepId === "recoverable workspace"
            ? yield* runner.fileSystem.readFile(request.workspace, ".checkpoint-result", request.stepId)
            : undefined
          if (marker === "attempt-1") {
            if (!request.workspace.revision) return yield* Effect.fail(new Error("Missing input snapshot"))
            yield* runner.persistence.restore({
              stepId: request.stepId,
              workflowId: request.workflowId,
              checkpoint: new CI.WorkspaceCheckpoint("input", request.workspace, request.workspace.revision),
            })
            return yield* Effect.fail(new Error("expected-checkpoint-failure-after-container-replacement"))
          }
          return yield* runner.persistence.commit(request)
        }),
      },
    })
    return result.plan
  }
}
