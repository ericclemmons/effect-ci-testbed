import type { WorkflowStep } from "cloudflare:workers"
import type { ReleaseManager } from "../../release-manager/src/release-manager.ts"
import { evaluateHealth, type HealthSample, type HealthPolicy, type HealthDecision } from "../../../packages/cloudflare/src/health-gate.ts"
import { healthChart } from "../../../packages/cloudflare/src/health-chart.ts"
import { routeHealthReview, resolveHealthReview, type HealthRoute, type ReviewMargins } from "../../../packages/cloudflare/src/health-review.ts"
import { probeBatch, cohortSample } from "./hmd-cohort.ts"

const baselineVersion = "09593237-23b2-4873-bd04-88c8e8488840"
const candidateVersion = "c94cee12-0bf4-48fb-bb42-9235f7ab7a3c"
const origin = "https://effect-ci-hmd-demo.ericclemmons.workers.dev"
const once = { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" } as const
const margins = { maxErrorRate: 0.1, maxIncrease: 0.05, errorGuardBand: 0.02, increaseGuardBand: 0.01 }

/** Structured, immutable host presentation input; no SVG, credentials or approval capability. */
export interface HmdObservation {
  readonly owner: string
  readonly phase: 10 | 25 | 75 | 100
  readonly baseline: HealthSample
  readonly candidate: HealthSample
  readonly policy: HealthPolicy
  readonly margins: ReviewMargins
  readonly decision: HealthDecision
  readonly route: HealthRoute
  readonly snapshot: string
  readonly expiresAt: number
}
export type HmdReviewUpdate =
  | { readonly type: "observed"; readonly observations: ReadonlyArray<HmdObservation> }
  | { readonly type: "settled"; readonly observation: HmdObservation; readonly basis: "health" | "human-risk-acceptance" | "deadline-risk-acceptance" }
  | { readonly type: "restored"; readonly failed: boolean }
export type HmdReviewObserver = (update: HmdReviewUpdate) => Promise<void>

/** Explicit release policy, never applied to the strict automatic controller. */
export interface HmdProgressPolicy {
  readonly autoProgressMinutes: number
  readonly allowRegressionOverride: boolean
  /** Atomically fence late/manual decisions before accepting the deadline. */
  readonly onDeadline: (observation: HmdObservation) => Promise<void>
}

// Copy before freezing: observers cannot mutate the checkpoint result or later release decisions.
function immutable<T>(value: T): T {
  const copy = structuredClone(value)
  const freeze = (item: unknown) => {
    if (item && typeof item === "object") {
      for (const nested of Object.values(item)) freeze(nested)
      Object.freeze(item)
    }
  }
  freeze(copy)
  return copy
}

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
    observe?: HmdReviewObserver,
    progress?: HmdProgressPolicy,
  ) {
    if (progress && (!Number.isInteger(progress.autoProgressMinutes) || progress.autoProgressMinutes < 1 || progress.autoProgressMinutes > 5)) {
      throw terminal("Invalid HMD progression deadline (1–5 minutes)")
    }
    const claimed = await step.do("release:claim", once, () => broker.begin(owner, candidateVersion))
    const observations = []
    const history: HmdObservation[] = []
    try {
      if (claimed.previous.length !== 1 || claimed.previous[0]?.version !== baselineVersion || claimed.previous[0]?.percentage !== 100) {
        throw terminal("Unexpected review-lab baseline")
      }
      const from = await step.do("health:baseline-start", once, async () => Date.now())
      const batch = await step.do("health:baseline", once, () => probe(origin, `${owner}-baseline`, [baselineVersion]))
      if (batch.unknown) throw terminal("Invalid baseline receipts")
      const baseline = await step.do("health:baseline-close", once, async () => cohortSample([batch], baselineVersion, from, Math.max(from + 1, Date.now())))
      for (const phase of [10, 25, 75, 100] as const) {
        await step.do(`release:promote-${phase}`, once, () => broker.promote(owner, phase))
        const phaseStartedAt = await step.do(`health:start-${phase}`, once, async () => Math.max(history.at(-1)?.candidate.to ?? baseline.to, Date.now()))
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
          const strictRoute = routeHealthReview(decision, margins)
          const route: HealthRoute = strictRoute.status === "rollback" && progress?.allowRegressionOverride
            ? { status: "review", reason: `Regression detected: ${strictRoute.reason}. Explicit emergency override only; no automatic progression.` }
            : strictRoute
          const evidence = { owner, phase, baseline, candidate, policy, margins, decision, route,
            ...(progress ? { progression: { autoProgressMinutes: progress.autoProgressMinutes, allowRegressionOverride: progress.allowRegressionOverride } } : {}) }
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(evidence)))
          return { ...evidence, snapshot: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
            expiresAt: observedAt + (progress?.autoProgressMinutes ?? 5) * 60_000,
            chart: healthChart([{ elapsedSeconds: (observedAt - phaseStartedAt) / 1000, decision }],
              { baseline: baselineVersion, candidate: candidateVersion, maxErrorRate: margins.maxErrorRate }) }
        })
        const { chart: _chart, ...observation } = snapshot
        history.push(observation)
        // A confirmed regression restores first; no renderer/notification can delay recovery.
        if (snapshot.route.status === "rollback") throw terminal("Conclusive regression; approval is prohibited")
        // Sibling checkpoints only: no notification or rendering inside a health step.do.
        // A failed required observer fails closed and restores the owned allocation.
        await observe?.(immutable({ type: "observed", observations: history }))
        let basis: "health" | "human-risk-acceptance" | "deadline-risk-acceptance" = "health"
        let approval: { readonly reason: string; readonly acceptedAt: number } | undefined
        if (snapshot.route.status === "review") {
          // Native step outputs are truncated: keep the approval identity and risk summary small.
          await step.do(`review:request-${phase}`, once, async () => ({ snapshot: snapshot.snapshot,
            expiresAt: snapshot.expiresAt, phase, baselineVersion, candidateVersion,
            reason: snapshot.route.status === "review" ? snapshot.route.reason : "",
            baselineTrials: snapshot.baseline.trials, candidateTrials: snapshot.candidate.trials,
            candidateFailures: snapshot.candidate.failures, candidateBounds: snapshot.decision.candidate,
            increaseBounds: snapshot.decision.increase, margins, evidenceSource: "closed-client-http-cohort" }))
          await step.do(`release:renew-before-review-${phase}`, once, () => broker.renew(owner))
          let response: { payload: unknown } | undefined
          try {
            response = await step.waitForEvent(`review:phase-${phase}`, { type: `hmd-review-${phase}`, timeout: `${progress?.autoProgressMinutes ?? 5} minutes` })
          } catch (error) {
            // Only an actual native wait timeout is a release-policy deadline.
            // Delivery/auth/unknown errors, regression and lost ownership still restore.
            if (!progress || snapshot.decision.status === "regression" ||
              !(error instanceof Error) || error.name !== "WorkflowTimeoutError") throw error
          }
          // Checkpoint the acceptance time: replay preserves the original deadline evaluation.
          const resolution = await step.do(`review:resolve-${phase}`, once, async () => {
            const acceptedAt = Date.now()
            if (!response) {
              if (!progress || acceptedAt < snapshot.expiresAt) throw terminal("Progression deadline has not elapsed")
              await progress.onDeadline(observation)
              return { status: "advance" as const, basis: "deadline-risk-acceptance" as const,
                reason: "Configured progression deadline elapsed; original evidence remains inconclusive or within margins", acceptedAt }
            }
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
        await observe?.(immutable({ type: "settled", observation, basis }))
      }
      const restored = await step.do("release:lab-cleanup", once, () => broker.rollback(owner))
      // Reporting must not turn successful recovery into a second deployment mutation.
      try { await observe?.(immutable({ type: "restored", failed: false })) } catch { /* allocation already restored */ }
      return { status: "reviewed-all-phases", observations, restored: restored.deployment,
        releaseCommitted: false, wobsVerified: false, evidenceSource: "closed-client-http-cohort" }
    } catch {
      await step.do("release:restore-baseline", once, () => broker.rollback(owner))
      if (history.at(-1)?.route.status === "rollback") {
        try { await observe?.(immutable({ type: "observed", observations: history })) } catch { /* recovery takes precedence */ }
      }
      try { await observe?.(immutable({ type: "restored", failed: true })) } catch { /* preserve the recovery result */ }
      throw terminal("Review release failed closed; prior allocation restored")
    }
}
