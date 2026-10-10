import type { WorkflowStep } from "cloudflare:workers"
import type { ReleaseManager } from "../../release-manager/src/release-manager.ts"
import { evaluateHealth } from "../../../packages/cloudflare/src/health-gate.ts"
import { healthChart } from "../../../packages/cloudflare/src/health-chart.ts"
import { routeHealthReview, resolveHealthReview } from "../../../packages/cloudflare/src/health-review.ts"
import { probeBatch, cohortSample } from "./hmd-cohort.ts"

const baselineVersion = "09593237-23b2-4873-bd04-88c8e8488840"
const candidateVersion = "c94cee12-0bf4-48fb-bb42-9235f7ab7a3c"
const origin = "https://effect-ci-hmd-demo.ericclemmons.workers.dev"
const once = { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" } as const
const margins = { maxErrorRate: 0.1, maxIncrease: 0.05, errorGuardBand: 0.02, increaseGuardBand: 0.01 }

/** Opt-in administrative approval lab, separate from strict automatic HMD.
 * Events enter only via Cloudflare's authenticated Workflow API, not a public endpoint.
 * This class must not accept forwarded unauthenticated notification payloads.
 */
export async function runHumanReviewedHmd(
    owner: string,
    step: WorkflowStep,
    broker: Pick<ReleaseManager, "begin" | "promote" | "rollback" | "renew">,
    probe = probeBatch,
    terminal: (message: string) => Error = (message) => new Error(message),
  ) {
    const claimed = await step.do("release:claim", once, () => broker.begin(owner, candidateVersion))
    const observations = []
    try {
      if (claimed.previous.length !== 1 || claimed.previous[0]?.version !== baselineVersion || claimed.previous[0]?.percentage !== 100) {
        throw terminal("Unexpected review-lab baseline")
      }
      const from = await step.do("health:baseline-start", once, async () => Date.now())
      const batch = await step.do("health:baseline", once, () => probe(origin, `${owner}-baseline`, [baselineVersion]))
      if (batch.unknown) throw terminal("Invalid baseline receipts")
      const baseline = await step.do("health:baseline-close", once, async () => cohortSample([batch], baselineVersion, from, Math.max(from + 1, Date.now())))
      for (const phase of [10, 25, 75, 100]) {
        await step.do(`release:promote-${phase}`, once, () => broker.promote(owner, phase))
        const phaseStartedAt = await step.do(`health:start-${phase}`, once, async () => Math.max(baseline.to, Date.now()))
        const receipts = await step.do(`health:cohort-${phase}`, once, () => probe(origin, `${owner}-${phase}`, [baselineVersion, candidateVersion]))
        // Broken attribution is not an approvable shortage of statistical power.
        if (receipts.unknown) throw terminal("Invalid candidate receipts")
        const snapshot = await step.do(`health:snapshot-${phase}`, once, async () => {
          const observedAt = Math.max(phaseStartedAt + 1, Date.now())
          const candidate = cohortSample([receipts], candidateVersion, phaseStartedAt, observedAt)
          const policy = { baselineVersion, candidateVersion, phaseStartedAt,
            baselineWindow: { from: baseline.from, to: baseline.to }, minTrials: 20,
            maxErrorRate: margins.maxErrorRate, maxIncrease: margins.maxIncrease, alpha: 0.05, comparisons: 4 }
          const decision = evaluateHealth(baseline, candidate, policy)
          const route = routeHealthReview(decision, margins)
          const evidence = { owner, phase, baseline, candidate, policy, margins, decision, route }
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(evidence)))
          return { ...evidence, snapshot: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
            expiresAt: observedAt + 5 * 60_000,
            chart: healthChart([{ elapsedSeconds: (observedAt - phaseStartedAt) / 1000, decision }],
              { baseline: baselineVersion, candidate: candidateVersion, maxErrorRate: margins.maxErrorRate }) }
        })
        if (snapshot.route.status === "rollback") throw terminal("Conclusive regression; approval is prohibited")
        let basis: "health" | "human-risk-acceptance" = "health"
        let approval: { readonly reason: string; readonly acceptedAt: number } | undefined
        if (snapshot.route.status === "review") {
          await step.do(`release:renew-before-review-${phase}`, once, () => broker.renew(owner))
          const response = await step.waitForEvent(`review:phase-${phase}`, { type: `hmd-review-${phase}`, timeout: "5 minutes" })
          // Checkpoint the acceptance time: replay preserves the original deadline evaluation.
          const resolution = await step.do(`review:resolve-${phase}`, once, async () => {
            const acceptedAt = Date.now()
            return { ...resolveHealthReview(snapshot, response.payload, acceptedAt), acceptedAt }
          })
          if (resolution.status === "rollback") throw terminal("Human rejected the release")
          basis = resolution.basis
          approval = { reason: resolution.reason, acceptedAt: resolution.acceptedAt }
          // Renew rejects an expired owner; same-phase replay independently checks deployment drift.
          await step.do(`release:renew-after-review-${phase}`, once, () => broker.renew(owner))
          await step.do(`release:verify-after-review-${phase}`, once, () => broker.promote(owner, phase))
        }
        observations.push({ ...snapshot, basis, ...(approval ? { approval } : {}) })
      }
      const restored = await step.do("release:lab-cleanup", once, () => broker.rollback(owner))
      return { status: "reviewed-all-phases", observations, restored: restored.deployment,
        releaseCommitted: false, wobsVerified: false, evidenceSource: "closed-client-http-cohort" }
    } catch {
      await step.do("release:restore-baseline", once, () => broker.rollback(owner))
      throw terminal("Review release failed closed; prior allocation restored")
    }
}
