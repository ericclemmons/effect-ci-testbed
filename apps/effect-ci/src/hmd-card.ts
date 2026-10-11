import type { WorkflowStep } from "cloudflare:workers"
import type { HmdReviewObserver } from "../../example-runner/src/hmd-review-runner.ts"
import type { HealthPoint } from "../../../packages/cloudflare/src/health-chart.ts"
import type { PrivateSlackImageResult } from "../../../packages/github-cloudflare/src/slack-images.ts"
import type { RunCard } from "../../../packages/github-cloudflare/src/run-card.ts"

interface HostHealthServices {
  render(points: ReadonlyArray<HealthPoint>, options: { baseline: string; candidate: string; maxErrorRate: number }): Promise<Uint8Array>
  upload(runId: string, snapshot: string, png: Uint8Array): Promise<PrivateSlackImageResult>
  /** Update the caller's existing owned card/receipt; never allocate a separate HMD message. */
  publish(card: RunCard, checkpoint: string): Promise<void>
}
const once = { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" } as const

/** Host-side bridge. This does not authenticate approvals or dispatch a Workflow.
 * The native controller calls it between checkpoints, not from an action's step.do.
 */
export function hmdCardObserver(runId: string, step: WorkflowStep, card: RunCard, services: HostHealthServices): HmdReviewObserver {
  return async (update) => {
    if (update.type !== "observed") return
    const current = update.observations.at(-1)
    if (!current || update.observations.length > 4 || card.snapshot().identity.instanceId !== runId ||
      current.owner !== runId || !/^[a-f0-9]{64}$/.test(current.snapshot)) throw new Error("Invalid HMD card identity")
    const baseline = update.observations[0]!.baseline
    let previousTime = -1
    let previousPhase = 0
    const points = update.observations.map((observation): HealthPoint => {
      const elapsedSeconds = (observation.candidate.to - baseline.from) / 1000
      if (observation.owner !== runId || !/^[a-f0-9]{64}$/.test(observation.snapshot) ||
        ![10, 25, 75, 100].includes(observation.phase) || observation.phase <= previousPhase || elapsedSeconds <= previousTime ||
        observation.baseline.version !== baseline.version || observation.baseline.from !== baseline.from ||
        observation.baseline.to !== baseline.to || observation.candidate.version !== current.candidate.version ||
        observation.policy.baselineVersion !== baseline.version || observation.policy.candidateVersion !== current.candidate.version ||
        observation.policy.maxErrorRate !== current.policy.maxErrorRate) throw new Error("Mixed HMD card history")
      previousTime = elapsedSeconds
      previousPhase = observation.phase
      return { elapsedSeconds, decision: observation.decision,
        baselineSample: observation.baseline, candidateSample: observation.candidate }
    })
    // Persist only the small file receipt, not PNG bytes or credentials in Workflow history.
    const image = await step.do(`notification:hmd-image-${current.phase}`, once, async () => {
      try {
        const png = await services.render(points, { baseline: baseline.version.slice(0, 8),
          candidate: current.candidate.version.slice(0, 8), maxErrorRate: current.policy.maxErrorRate })
        return await services.upload(runId, current.snapshot, png)
      } catch { return { ok: false as const } }
    })
    // Failure clears an older phase's graph; text still describes the current pinned observation.
    card.setHealth({ phase: current.phase, decision: current.decision.status === "regression" && current.route.status === "review" ? "regression" : current.decision.status === "regression" ? "rollback" : current.decision.status,
      evidenceSource: "closed-client-http-cohort" }, image.ok ? image.fileId : undefined)
    await services.publish(card, `notification:hmd-card-${current.phase}`)
  }
}
