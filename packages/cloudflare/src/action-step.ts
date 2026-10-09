import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers"

type HandleData = { readonly provider: string; readonly value: any }

type WorkspaceData = {
  readonly id: string
  readonly cwd: string
  readonly revision?: HandleData
}

type CheckpointData = {
  readonly name: string
  readonly workspace: WorkspaceData
  readonly handle: HandleData
}

type ActionValue =
  | { readonly kind: "workspace"; readonly data: WorkspaceData }
  | { readonly kind: "checkpoint"; readonly data: CheckpointData }
  | { readonly kind: "artifact"; readonly data: { readonly name: string; readonly paths: ReadonlyArray<string>; readonly checkpoint: CheckpointData } }
  | { readonly kind: "void"; readonly data: null }
  // The provider validates ordinary structured-clone values at its boundary.
  | { readonly kind: "value"; readonly data: any }

const workspaceData = (workspace: CI.Workspace): WorkspaceData => ({
  id: workspace.id!, cwd: workspace.cwd,
  ...(workspace.revision === undefined ? {} : { revision: { provider: workspace.revision.provider, value: workspace.revision.value } }),
})

const checkpointData = (checkpoint: CI.WorkspaceCheckpoint): CheckpointData => ({
  name: checkpoint.name, workspace: workspaceData(checkpoint.workspace),
  handle: { provider: checkpoint.handle.provider, value: checkpoint.handle.value },
})

const encodeValue = (value: unknown): ActionValue => {
  if (value instanceof CI.Workspace) return { kind: "workspace", data: workspaceData(value) }
  if (value instanceof CI.WorkspaceCheckpoint) return { kind: "checkpoint", data: checkpointData(value) }
  if (value instanceof CI.WorkspaceArtifact) return {
    kind: "artifact", data: { name: value.name, paths: value.paths, checkpoint: checkpointData(value.checkpoint) },
  }
  return value === undefined ? { kind: "void", data: null } : { kind: "value", data: value }
}

const restoreWorkspace = (data: WorkspaceData): CI.Workspace => CI.Workspace.remote(data.id, data.cwd, data.revision)
const restoreCheckpoint = (data: CheckpointData): CI.WorkspaceCheckpoint =>
  new CI.WorkspaceCheckpoint(data.name, restoreWorkspace(data.workspace), data.handle)

const decodeValue = (value: ActionValue): unknown => {
  switch (value.kind) {
    case "workspace": return restoreWorkspace(value.data)
    case "checkpoint": return restoreCheckpoint(value.data)
    case "artifact": return new CI.WorkspaceArtifact(value.data.name, value.data.paths, restoreCheckpoint(value.data.checkpoint))
    case "void": return undefined
    case "value": return value.data
  }
}

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
          return {
            commands: result.commands,
            events: result.events ?? [],
            ...(result.metadata ? { metadata: result.metadata } : {}),
            value: encodeValue(result.value),
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
      value: decodeValue(result.value),
    }
  }),
})
