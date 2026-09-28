import { createReadStream } from "node:fs"
import { resolve } from "node:path"
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

const required = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

const workflowPath = required("EFFECT_CI_WORKFLOW")
const module = await import(pathToFileURL(resolve(workflowPath)).href) as {
  readonly default?: CI.Workflow<unknown>
}
const workflow = module.default

if (!workflow) throw new Error(`${workflowPath} must default-export a CI workflow`)

const event = process.env.EFFECT_CI_EVENT as CI.WorkflowEventName | undefined
const configuredDecision = process.env.EFFECT_CI_APPROVAL
const controlFileDescriptor = Number(process.env.EFFECT_CI_CONTROL_FD)

interface ApprovalResponse {
  readonly type: "approval.resolved"
  readonly requestId: string
  readonly decision: CI.ApprovalDecision
  readonly actor?: string
}

const pendingResponses = new Map<string, ApprovalResponse>()
const responseWaiters = new Map<string, (response: ApprovalResponse) => void>()

let approval: CI.ApprovalHandler | undefined

if (Number.isInteger(controlFileDescriptor)) {
  const control = createInterface({
    input: createReadStream("/dev/null", {
      fd: controlFileDescriptor,
      autoClose: false,
    }),
  })

  void (async () => {
    for await (const line of control) {
      const response = JSON.parse(line) as ApprovalResponse
      const waiter = responseWaiters.get(response.requestId)

      if (waiter) {
        responseWaiters.delete(response.requestId)
        waiter(response)
      } else {
        pendingResponses.set(response.requestId, response)
      }
    }
  })()

  approval = {
    request: (request) => Effect.tryPromise({
      try: () => new Promise<CI.ApprovalResult>((resolve) => {
        const pending = pendingResponses.get(request.requestId)

        if (pending) {
          pendingResponses.delete(request.requestId)
          resolve({
            decision: pending.decision,
            ...(pending.actor ? { actor: pending.actor } : {}),
          })
          return
        }

        responseWaiters.set(request.requestId, (response) => resolve({
          decision: response.decision,
          ...(response.actor ? { actor: response.actor } : {}),
        }))
      }),
      catch: (error) => error,
    }),
  }
} else if (configuredDecision === "approved" || configuredDecision === "rejected") {
  approval = {
    request: () => Effect.succeed({ decision: configuredDecision }),
  }
}

await CI.runPromise(workflow, {
  ...(approval ? { approval } : {}),
  env: process.env.NODE_ENV ?? (process.env.CI ? "test" : "development"),
  event: { type: event ?? "workflow_dispatch" },
  mode: process.env.DRY_RUN ? "plan" : "execute",
})
