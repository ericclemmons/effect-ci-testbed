import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import { runHumanReviewedHmd, type HmdReviewUpdate } from "../../example-runner/src/hmd-review-runner.ts"
import { RELEASE_ACCOUNT, type ReleaseManager } from "../../release-manager/src/release-manager.ts"
import { RunCard } from "../../../packages/github-cloudflare/src/run-card.ts"
import { hmdCardObserver } from "./hmd-card.ts"
import type { HealthChartRenderer } from "./health-renderer.ts"
import type { PrivateSlackImages } from "./private-images.ts"
import type { PrivateSlackCards } from "./private-cards.ts"
import type { HmdApprovals, HmdCapability } from "./hmd-approval.ts"
import type { WorkerEnvironment } from "../../../packages/github-cloudflare/src/worker.ts"

export interface HmdParameters { readonly intent: "hmd-review-lab"; readonly revision: string }
interface Environment extends WorkerEnvironment { RELEASE_MANAGER: Pick<ReleaseManager, "begin" | "renew" | "promote" | "rollback"> }
const once = { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" } as const

/** Dedicated fixed-target administrative lab, never dispatched by normal GitHub CI. */
export class HmdReviewWorkflow extends WorkflowEntrypoint<Environment, HmdParameters> {
  override async run(event: Readonly<WorkflowEvent<HmdParameters>>, step: WorkflowStep) {
    if (event.payload?.intent !== "hmd-review-lab" || !/^[a-f0-9]{40}$/.test(event.payload.revision) ||
      !this.env.SLACK_BOT_TOKEN || !this.env.SLACK_APP_ID || !this.env.SLACK_TEAM_ID || !this.env.SLACK_CHANNEL_ID ||
      !this.env.SLACK_SIGNING_SECRET || !this.env.SLACK_APPROVER_IDS || !this.env.RELEASE_MANAGER) throw new NonRetryableError("HMD lab is not configured")
    const host = this.ctx.exports as unknown as { HealthChartRenderer: Service<HealthChartRenderer>;
      PrivateSlackImages: DurableObjectNamespace<PrivateSlackImages>; PrivateSlackCards: DurableObjectNamespace<PrivateSlackCards>;
      HmdApprovals: DurableObjectNamespace<HmdApprovals> }
    const owner = event.instanceId
    const images = host.PrivateSlackImages.getByName(owner)
    const cards = host.PrivateSlackCards.getByName(owner)
    const reviews = host.HmdApprovals.getByName(owner)
    const card = new RunCard({ instanceId: owner, repository: "ericclemmons/effect-ci-testbed", revision: event.payload.revision,
      detailsUrl: `https://dash.cloudflare.com/${RELEASE_ACCOUNT}/workers/workflows/effect-ci-hmd-review/instance/${encodeURIComponent(owner)}` })
    const timestamp = event.timestamp.toISOString()
    const workflowId = "health-mediated-approval lab"
    const status = (stepId: string, state: "queued" | "complete" | "running" | "warning" | "failed") =>
      card.update({ type: "step.status", workflowId, stepId, status: state, optional: false, timestamp })
    for (const id of ["claim", "baseline", "10%", "25%", "75%", "100%", "restore baseline"]) status(id, "queued")
    let sequence = 0
    let observed = false
    let restored = false
    let capability: HmdCapability | undefined
    const publish = async (_card: RunCard, checkpoint: string) => {
      const frame = card.render()
      const blocks = [...frame.blocks, { type: "context", elements: [{ type: "plain_text",
        text: "Fixed-target HTTP lab. Risk acceptance is not health proof. Final cleanup restores baseline; no production release." }] },
        ...(capability ? [{ type: "actions", elements: [
          { type: "button", action_id: "hmd_approve", text: { type: "plain_text", text: "Approve" }, style: "primary", value: JSON.stringify(capability) },
          { type: "button", action_id: "hmd_reject", text: { type: "plain_text", text: "Reject" }, style: "danger", value: JSON.stringify(capability) },
        ] }] : [])]
      const currentSequence = sequence++
      await step.do(checkpoint, once, async () => {
        const receipt = await cards.publish(owner, currentSequence, { text: frame.text, blocks })
        if (!receipt.ok) throw new NonRetryableError("HMD card needs delivery reconciliation")
        return { ts: receipt.ts, sequence: currentSequence }
      })
    }
    const graph = hmdCardObserver(owner, step, card, {
      render: (points, options) => host.HealthChartRenderer.render(points, options),
      upload: (run, snapshot, png) => images.upload(run, snapshot, png), publish,
    })
    const observe = async (update: HmdReviewUpdate) => {
      if (update.type === "observed") {
        observed = true
        const current = update.observations.at(-1)!
        status("claim", "complete"); status("baseline", "complete")
        status(`${current.phase}%`, current.route.status === "rollback" ? "failed" : "running")
        if (current.route.status === "review") {
          capability = await step.do(`review:slack-register-${current.phase}`, once, async () => {
            const receipt = await reviews.register(owner, current.phase, current.snapshot, current.expiresAt)
            return { owner: receipt.owner, phase: receipt.phase, snapshot: receipt.snapshot, token: receipt.token }
          })
          card.update({ type: "approval.requested", workflowId, stepId: `${current.phase}%`, requestId: current.snapshot,
            approval: { title: `Review ${current.phase}% release risk`, summary: `${current.route.reason}. Rationale required. Deadline: ${new Date(current.expiresAt).toISOString()}.` }, timestamp })
        }
        await graph(update)
      } else if (update.type === "settled") {
        capability = undefined
        await step.do(`review:slack-close-${update.observation.phase}`, once, () => reviews.close(owner))
        card.update({ type: "approval.resolved", workflowId, stepId: `${update.observation.phase}%`, requestId: update.observation.snapshot,
          decision: "approved", timestamp })
        status(`${update.observation.phase}%`, update.basis === "human-risk-acceptance" ? "warning" : "complete")
        await publish(card, `notification:hmd-settled-${update.observation.phase}`)
      } else {
        restored = true
        capability = undefined
        await step.do("review:slack-terminal", once, () => reviews.close(owner))
        status("restore baseline", "complete")
        card.update({ type: "workflow.completed", workflowId, conclusion: update.failed ? "failure" : "success", timestamp })
        await publish(card, "notification:hmd-restored")
      }
    }
    // Establish the one owned card before acquiring any deployment authority.
    await publish(card, "notification:hmd-start")
    try {
      return await runHumanReviewedHmd(owner, step, this.env.RELEASE_MANAGER, undefined,
        (message) => new NonRetryableError(message), observe)
    } catch (error) {
      if (!observed && !restored) {
        // Claim/baseline failures precede observation. Do not falsely claim that
        // cleanup succeeded; the broker owns independent recovery.
        status("claim", "failed")
        card.update({ type: "workflow.completed", workflowId, conclusion: "failure", timestamp })
        try { await publish(card, "notification:hmd-early-failure") } catch { /* retain the original failure */ }
      }
      throw error
    }
  }
}
