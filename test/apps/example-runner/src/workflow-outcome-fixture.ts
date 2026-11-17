import type { WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"

export async function runWorkflowOutcomeFixture(owner: string, step: WorkflowStep, mode: "good" | "bad" | "reset-then-success") {
  if (!owner || !["good", "bad", "reset-then-success"].includes(mode)) throw new NonRetryableError("Invalid Workflow outcome fixture")
  const receipt = await step.do("outcome:admitted", { retries: { limit: 0, delay: "1 second" } }, async () => ({ owner, mode }))
  if (mode === "bad") {
    await step.do("outcome:terminal-failure", { retries: { limit: 0, delay: "1 second" } }, async () => {
      throw new NonRetryableError("Owned logical outcome fixture failure")
    })
  }
  if (mode === "reset-then-success") {
    await step.do("outcome:bounded-retry", { retries: { limit: 1, delay: "1 second" }, timeout: "10 seconds" }, async context => {
      if (context.attempt === 1) throw new Error("Owned retry diagnostic; not a terminal outcome")
      return { attempt: context.attempt }
    })
    await step.waitForEvent("outcome:wait-for-reset-owner", { type: "outcome-finish", timeout: "2 minutes" })
  }
  return step.do("outcome:complete", { retries: { limit: 0, delay: "1 second" } }, async () => ({ ...receipt, status: "logical-success" }))
}
