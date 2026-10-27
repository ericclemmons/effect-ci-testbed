import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { RunCard } from "../../packages/github-cloudflare/src/run-card.ts"
import { recipe } from "./.cloudflare/ci/workflow.ts"

for (const scenario of ["retry", "failure", "cancel", "rollback", "rollback-failure", "decision-rejected"] as const) {
  const controller = new AbortController()
  const card = new RunCard({ instanceId: scenario, repository: "local", revision: "working-tree" })
  const events: Array<CI.RuntimeEvent> = []
  try {
    await Effect.runPromise(CI.run(recipe(scenario), {
      output: "silent",
      approval: { request: () => Effect.sleep(10).pipe(Effect.as({ decision: "rejected" as const, actor: "local-policy" })) },
      onEvent(event) {
        events.push(event)
        card.update(event)
        if (event.type === "step.lifecycle" || event.type === "workflow.lifecycle") console.log(scenario, CI.formatLifecycle(event))
        if (scenario === "cancel" && event.type === "step.lifecycle" && event.stepId === "work" && event.phase === "executing")
          setTimeout(() => controller.abort(), 20)
      },
    }), { signal: controller.signal })
  } catch {
    console.log(scenario, "execution did not succeed; inspect the terminal lifecycle outcome")
  }
  const stale = events.find(event => event.type === "step.lifecycle" && event.stepId === "work" && event.phase === "executing")
  console.log(JSON.stringify({ scenario, snapshot: card.snapshot(),
    staleUpdateAccepted: stale ? card.update(stale) : null, card: card.render({ statusOnly: true }).text }))
}
