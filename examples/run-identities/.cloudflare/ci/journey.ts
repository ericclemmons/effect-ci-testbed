import { execFileSync } from "node:child_process"
import * as CI from "@effect-ci-testbed/ci"
import { RunCard } from "../../../../packages/github-cloudflare/src/run-card.ts"
import workflow from "./workflow.ts"

const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const repository = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim()
const events: Array<CI.RuntimeEvent> = []
const run = async (previous?: CI.WorkflowAttempt) => {
  const card = new RunCard({ instanceId: "local-notification-preview", repository, revision })
  return CI.runPromise(workflow, {
    output: "silent",
    event: { type: "workflow_dispatch", source: { kind: "git", repository, revision } },
    ...(previous ? { rerun: { previous, steps: ["flaky check"] } } : {}),
    onEvent: event => { events.push(event); card.update(event) },
    onAttempt: attempt => {
      console.log(CI.formatAttempt(attempt))
      console.log(JSON.stringify({ details: CI.attemptDetails(attempt), notificationPreview: card.render() }))
    },
  })
}

const first = await run()
const original = JSON.stringify(first.attempt)
const second = await run(first.attempt)
const cursor = new CI.CorrelationCursor()
for (const event of events) cursor.accept(event)
const [oldEvent] = events
console.log(JSON.stringify({
  firstAttemptUnchanged: original === JSON.stringify(first.attempt),
  sameLogicalRun: first.attempt.identity?.logicalRunId === second.attempt.identity?.logicalRunId,
  oldEventAccepted: oldEvent ? cursor.accept(oldEvent) : undefined,
  finalOutcome: second.attempt.conclusion,
  reused: second.plan.nodes.filter(node => node.status === "reused").map(node => node.id),
}))
