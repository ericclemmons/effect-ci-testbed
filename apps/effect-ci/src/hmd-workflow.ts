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
import { nativeHmdSource } from "../../example-runner/src/hmd-native-source.ts"
import { hmdFailureReason } from "../../example-runner/src/hmd-failure.ts"

export interface HmdParameters { readonly intent: "hmd-review-lab"; readonly revision: string; readonly profile?: "healthy" | "regression"; readonly telemetry?: "experimental-native-wobs" }
interface Environment extends WorkerEnvironment { RELEASE_MANAGER: Pick<ReleaseManager, "begin" | "renew" | "promote" | "rollback">; ANALYTICS_SQL?: AnalyticsSQLBinding; HMD_REQUIRE_RATIONALE?: string; HMD_AUTO_PROGRESS_MINUTES?: string }
const once = { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" } as const

/** Dedicated fixed-target administrative lab, never dispatched by normal GitHub CI. */
export class HmdReviewWorkflow extends WorkflowEntrypoint<Environment, HmdParameters> {
  override async run(event: Readonly<WorkflowEvent<HmdParameters>>, step: WorkflowStep) {
    if (event.payload?.intent !== "hmd-review-lab" || !/^[a-f0-9]{40}$/.test(event.payload.revision) ||
      (event.payload.profile !== undefined && !["healthy", "regression"].includes(event.payload.profile)) ||
      (event.payload.telemetry !== undefined && event.payload.telemetry !== "experimental-native-wobs") ||
      (event.payload.telemetry && !this.env.ANALYTICS_SQL) ||
      !this.env.SLACK_BOT_TOKEN || !this.env.SLACK_APP_ID || !this.env.SLACK_TEAM_ID || !this.env.SLACK_CHANNEL_ID ||
      !this.env.SLACK_SIGNING_SECRET || !this.env.SLACK_APPROVER_IDS || !this.env.RELEASE_MANAGER) throw new NonRetryableError("HMD lab is not configured")
    const host = this.ctx.exports as unknown as { HealthChartRenderer: Service<HealthChartRenderer>;
      PrivateSlackImages: DurableObjectNamespace<PrivateSlackImages>; PrivateSlackCards: DurableObjectNamespace<PrivateSlackCards>;
      HmdApprovals: DurableObjectNamespace<HmdApprovals> }
    const owner = event.instanceId
    const autoProgressMinutes = Number(this.env.HMD_AUTO_PROGRESS_MINUTES ?? "2")
    if (!Number.isInteger(autoProgressMinutes) || autoProgressMinutes < 1 || autoProgressMinutes > 5) throw new NonRetryableError("HMD_AUTO_PROGRESS_MINUTES must be 1–5")
    const images = host.PrivateSlackImages.getByName(owner)
    const cards = host.PrivateSlackCards.getByName(owner)
    const reviews = host.HmdApprovals.getByName(owner)
    const card = new RunCard({ instanceId: owner, repository: "ericclemmons/effect-ci-testbed", revision: event.payload.revision,
      detailsUrl: `https://dash.cloudflare.com/${RELEASE_ACCOUNT}/workers/workflows/effect-ci-hmd-review/instance/${encodeURIComponent(owner)}` })
    const timestamp = event.timestamp.toISOString()
    const workflowId = "Demo release"
    const native = event.payload.telemetry === "experimental-native-wobs"
      ? nativeHmdSource((input) => this.env.ANALYTICS_SQL!.query(input)) : undefined
    const status = (stepId: string, state: "queued" | "complete" | "running" | "warning" | "failed" | "skipped") =>
      card.update({ type: "step.status", workflowId, stepId, status: state, optional: false, timestamp })
    for (const id of ["Prepare release", "Previous version", "10%", "25%", "75%", "100%", "Restore previous version"]) status(id, "queued")
    let sequence = 0
    let observed = false
    let restored = false
    let activePhase: 10 | 25 | 75 | 100 | undefined
    let capability: HmdCapability | undefined
    const publish = async (_card: RunCard, checkpoint: string) => {
      // Keep the full semantic history, but reverted releases need only the
      // executed stages and restoration in their operator-facing checklist.
      const frame = card.render({ hideSkipped: restored, ...(restored ? { rollbackStep: "Restore previous version" } : {}) })
      const blocks = [...frame.blocks, { type: "context", elements: [{ type: "plain_text",
        text: `${native ? "Native outcomes demo (experimental)" : "HTTP demo"} · Progress accepts risk · restores afterward` }] },
        ...(capability ? [{ type: "actions", elements: [
          { type: "button", action_id: "hmd_approve", text: { type: "plain_text", text: "Progress" }, style: "primary", value: JSON.stringify(capability) },
          { type: "button", action_id: "hmd_reject", text: { type: "plain_text", text: "Reject" }, style: "danger", value: JSON.stringify(capability) },
        ] }] : [])]
      const currentSequence = sequence++
      await step.do(checkpoint, once, async () => {
        const receipt = await cards.publish(owner, currentSequence, { text: frame.text, blocks })
        if (!receipt.ok) throw new NonRetryableError(`HMD card needs delivery reconciliation${receipt.error ? ` (${receipt.error})` : ""}`)
        return { ts: receipt.ts, sequence: currentSequence }
      })
    }
    const graph = hmdCardObserver(owner, step, card, {
      render: (points, options) => host.HealthChartRenderer.render(points, options),
      upload: (run, snapshot, png) => images.upload(run, snapshot, png), publish,
    })
    const observe = async (update: HmdReviewUpdate) => {
      if (update.type === "promoted") {
        activePhase = update.phase
        status("Prepare release", "complete"); status("Previous version", "complete")
        status(`${update.phase}%`, "running")
        await publish(card, `notification:hmd-promoted-${update.phase}`)
      } else if (update.type === "observed") {
        observed = true
        const current = update.observations.at(-1)!
        activePhase = current.phase
        const suffix = `${current.phase}${current.sample ? `-sample-${current.sample}` : ""}`
        status("Prepare release", "complete"); status("Previous version", "complete")
        status(`${current.phase}%`, current.route.status === "rollback" ? "failed" : "running")
        if (current.route.status === "review") {
          capability = await step.do(`review:slack-register-${suffix}`, once, async () => {
            const receipt = await reviews.register(owner, current.phase, current.snapshot, current.expiresAt, current.sample ?? 0)
            return { owner: receipt.owner, phase: receipt.phase, snapshot: receipt.snapshot, token: receipt.token }
          })
          card.update({ type: "approval.requested", workflowId, stepId: `${current.phase}%`, requestId: current.snapshot,
            approval: { title: `Progress past ${current.phase}%?`, summary: `${current.regressionDetected || current.decision.status === "regression" ? "Regression detected. Override, or restore at" : "Inconclusive. Auto-progress at"} ${new Date(current.expiresAt).toISOString().slice(11, 19)} UTC.${this.env.HMD_REQUIRE_RATIONALE === "true" ? " Rationale required." : ""}` }, timestamp })
        } else {
          capability = undefined
          await step.do(`review:slack-health-${suffix}`, once, () => reviews.close(owner))
          card.update({ type: "approval.resolved", workflowId, stepId: `${current.phase}%`, requestId: current.snapshot, decision: "approved", timestamp })
          status(`${current.phase}%`, "running")
        }
        await graph(update)
      } else if (update.type === "settled") {
        capability = undefined
        await step.do(`review:slack-close-${update.observation.phase}`, once, () => reviews.close(owner))
        card.update({ type: "approval.resolved", workflowId, stepId: `${update.observation.phase}%`, requestId: update.observation.snapshot,
          decision: "approved", timestamp })
        if (update.basis !== "human-risk-acceptance") status(`${update.observation.phase}%`, "complete")
        await publish(card, `notification:hmd-settled-${update.observation.phase}`)
      } else {
        restored = true
        capability = undefined
        await step.do("review:slack-terminal", once, () => reviews.close(owner))
        status("Prepare release", "complete")
        const health = card.snapshot().health
        if (update.failed && update.failure) {
          status("Previous version", health || activePhase ? "complete" : "failed")
          card.setFailure(update.failure.stepId, update.failure.reason)
          const phase = Number(update.failure.stepId.replace("%", ""))
          if ([10, 25, 75, 100].includes(phase)) activePhase = phase as 10 | 25 | 75 | 100
        } else if (health) {
          status("Previous version", "complete")
          if (update.failed) status(`${health.phase}%`, "failed")
        } else if (update.failed) {
          status("Previous version", activePhase ? "complete" : "failed")
          if (activePhase) status(`${activePhase}%`, "failed")
        }
        if (update.failed) for (const phase of [10, 25, 75, 100]) {
          if (!(activePhase ?? health?.phase) || phase > (activePhase ?? health!.phase)) status(`${phase}%`, "skipped")
        }
        status("Restore previous version", "complete")
        card.update({ type: "workflow.completed", workflowId, conclusion: update.failed ? "failure" : "success", timestamp })
        await publish(card, "notification:hmd-restored")
      }
    }
    // Establish the one owned card before acquiring any deployment authority.
    await publish(card, "notification:hmd-start")
    try {
      return await runHumanReviewedHmd(owner, step, this.env.RELEASE_MANAGER, undefined,
        (message) => new NonRetryableError(message), observe, { autoProgressMinutes, allowRegressionOverride: true,
          samplingIntervalSeconds: 30,
          onRefresh: (observation) => reviews.refresh(owner, observation.phase, observation.snapshot),
          onDeadline: (observation) => reviews.expire(owner, observation.phase, observation.snapshot) }, event.payload.profile ?? "healthy", native)
    } catch (error) {
      if (!observed && !restored) {
        // Claim/baseline failures precede observation. Do not falsely claim that
        // cleanup succeeded; the broker owns independent recovery.
        status("Prepare release", "failed")
        card.setFailure("Prepare release", hmdFailureReason(error))
        status("Previous version", "skipped")
        for (const phase of [10, 25, 75, 100]) status(`${phase}%`, "skipped")
        status("Restore previous version", "skipped")
        card.update({ type: "workflow.completed", workflowId, conclusion: "failure", timestamp })
        try { await publish(card, "notification:hmd-early-failure") } catch { /* retain the original failure */ }
      }
      throw error
    }
  }
}
