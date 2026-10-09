import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers"

export const makeActionExecutor = (
  step: Pick<WorkflowStep, "do">,
  activeBodies: Set<string>,
): CI.ActionExecutor => ({
  execute: (request) => Effect.gen(function* () {
    const services = yield* Effect.services<any>()
    const result = yield* Effect.tryPromise({
      try: () => step.do(`action:${JSON.stringify(request.stepId)}`, {
        retries: request.options.retries ?? { limit: 0, delay: 0, backoff: "constant" },
        ...(request.options.timeout === undefined ? {} : { timeout: request.options.timeout }),
      } as WorkflowStepConfig, async (context) => {
        activeBodies.add(request.stepId)
        try {
          const body = request.run(context.attempt)
          // Native timeout owns the retry history; Effect timeout additionally
          // interrupts fibers so an expired attempt cannot later commit a result.
          const timed = request.options.timeout === undefined ? body : body.pipe(Effect.timeout(request.options.timeout))
          const exit = await Effect.runPromiseExit(timed.pipe(Effect.provideServices(services)))
          // Preserve original errors, including a provider's NonRetryableError.
          if (Exit.isFailure(exit)) throw Cause.squash(exit.cause)
          const result = exit.value
          const value = result.value
          return {
            commands: result.commands,
            events: result.events ?? [],
            ...(result.metadata ? { metadata: result.metadata } : {}),
            value: value instanceof CI.Workspace
              ? { kind: "workspace" as const, data: { id: value.id!, cwd: value.cwd, revision: value.revision } }
              : value === undefined
              ? { kind: "void" as const, data: null }
              : { kind: "value" as const, data: value },
          }
        } finally {
          activeBodies.delete(request.stepId)
        }
      }),
      catch: (error) => error,
    })
    return {
      commands: result.commands,
      events: result.events,
      ...(result.metadata ? { metadata: result.metadata } : {}),
      value: result.value.kind === "workspace"
        ? CI.Workspace.remote(result.value.data.id, result.value.data.cwd, result.value.data.revision)
        : result.value.kind === "void" ? undefined : result.value.data,
    }
  }),
})
