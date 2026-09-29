import { resolve } from "node:path"
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

let approval: CI.ApprovalHandler | undefined

if (configuredDecision === "approved" || configuredDecision === "rejected") {
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
