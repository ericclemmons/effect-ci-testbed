import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import * as CI from "@effect-ci-testbed/ci"

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
if (event && workflow.on.length > 0 && !workflow.on.includes(event)) {
  console.log(`Skipping ${workflow.id}: it does not respond to ${event}`)
} else {
  await CI.runPromise(workflow, {
    env: process.env.NODE_ENV ?? (process.env.CI ? "test" : "development"),
    mode: process.env.DRY_RUN ? "plan" : "execute",
  })
}
