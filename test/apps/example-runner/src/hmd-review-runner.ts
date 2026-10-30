import type { WorkflowStep } from "cloudflare:workers"
import type { ReleaseManager } from "../../release-manager/src/release-manager.ts"
import { evaluateHealth, type HealthSample, type HealthPolicy, type HealthDecision } from "../../../../packages/cloudflare/src/health-gate.ts"
import { healthChart } from "../../../../packages/cloudflare/src/health-chart.ts"
import { routeHealthReview, resolveHealthReview, type HealthRoute, type ReviewMargins } from "../../../../packages/cloudflare/src/health-review.ts"
import { probeBatch, cohortSample } from "./hmd-cohort.ts"
import type { HmdNativeSource } from "./hmd-native-source.ts"
import type { ReceiptBatch } from "./wobs-samples.ts"
import { canRetryNativeQuery, nativeSqlPolicy } from "./wobs-sql-policy.ts"
import { hmdFailureReason } from "./hmd-failure.ts"

const baselineVersion = "09593237-23b2-4873-bd04-88c8e8488840"
const healthyCandidate = "c94cee12-0bf4-48fb-bb42-9235f7ab7a3c"
const failingCandidate = "02de9b2e-95d0-49e6-b787-467e25c5a65c"
const origin = "https://effect-ci-hmd-demo.eclemmons.workers.dev"
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
  readonly sample?: number
  /** Sticky release safety state; the latest measured decision is still retained. */
  readonly regressionDetected?: boolean
  readonly evidenceSource?: "closed-client-http-cohort" | "experimental-native-wobs"
  /** Observation time differs from the frozen request window while SQL ingests. */
  readonly observedAt?: number
  readonly telemetry?: { readonly complete: boolean; readonly missing: number; readonly conflicts: number; readonly invalid: number }
}
export type HmdReviewUpdate =
  | { readonly type: "promoted"; readonly phase: 10 | 25 | 75 | 100 }
  | { readonly type: "observed"; readonly observations: ReadonlyArray<HmdObservation> }
  | { readonly type: "settled"; readonly observation: HmdObservation; readonly basis: "health" | "human-risk-acceptance" | "deadline-risk-acceptance" }
  | { readonly type: "restored"; readonly failed: boolean; readonly failure?: { readonly stepId: string; readonly reason: string } }
export type HmdReviewObserver = (update: HmdReviewUpdate) => Promise<void>

/** Explicit release policy, never applied to the strict automatic controller. */
export interface HmdProgressPolicy {
  readonly autoProgressMinutes: number
  readonly allowRegressionOverride: boolean
  /** Atomically fence late/manual decisions before accepting the deadline. */
  readonly onDeadline: (observation: HmdObservation) => Promise<void>
  readonly samplingIntervalSeconds?: number
  /** Fence old buttons before collecting new evidence. False means a click is in flight. */
  readonly onRefresh?: (observation: HmdObservation) => Promise<boolean>
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
    candidateProfile: "healthy" | "regression" = "healthy",
    native?: HmdNativeSource,
  ) {
    if (!["healthy", "regression"].includes(candidateProfile)) throw terminal("Invalid fixed-target candidate profile")
    const candidateVersion = candidateProfile === "regression" ? failingCandidate : healthyCandidate
    if (progress && (!Number.isInteger(progress.autoProgressMinutes) || progress.autoProgressMinutes < 1 || progress.autoProgressMinutes > 5)) {
      throw terminal("Invalid HMD progression deadline (1–5 minutes)")
    }
    if (progress?.samplingIntervalSeconds !== undefined && (!Number.isInteger(progress.samplingIntervalSeconds) ||
      progress.samplingIntervalSeconds < 15 || progress.samplingIntervalSeconds > 60 || !progress.onRefresh)) throw terminal("Invalid HMD sampling interval")
    const claimed = await step.do("release:claim", once, () => broker.begin(owner, candidateVersion))
    const observations = []
    const history: HmdObservation[] = []
    let failedStep = "Previous version"
    try {
      if (claimed.previous.length !== 1 || claimed.previous[0]?.version !== baselineVersion || claimed.previous[0]?.percentage !== 100) {
        throw terminal("Unexpected review-lab baseline")
      }
      const from = await step.do("health:baseline-start", once, async () => Date.now())
      const evidenceSource = native ? "experimental-native-wobs" as const : "closed-client-http-cohort" as const
      const readNative = async (name: string, batches: ReceiptBatch[], versions: string[], start: number, end: number) =>
        step.do(name, nativeSqlPolicy, async () => {
          try { return await native!.read(batches, versions, start, end) }
          catch (error) {
            if (canRetryNativeQuery(error)) throw error
            throw terminal("Native health query failed; no HTTP fallback")
          }
        })
      let baseline: HealthSample
      if (native) {
        const batch = await step.do("health:baseline-receipts", once, () => native.capture([baselineVersion]))
        const to = await step.do("health:baseline-window", once, async () => Math.max(from + 1, Date.now()))
        let result = await readNative("health:native-baseline-0", [batch], [baselineVersion], from, to)
        for (let attempt = 1; !result.complete && attempt < 4; attempt++) {
          await step.do(`release:renew-baseline-${attempt}`, once, () => broker.renew(owner))
          await step.sleep(`health:baseline-ingestion-${attempt}`, "30 seconds")
          result = await readNative(`health:native-baseline-${attempt}`, [batch], [baselineVersion], from, to)
        }
        // Pin one complete previous cohort before promotion. Do not replace a
        // frozen sampled/missing baseline or grow it until it happens to pass.
        if (!result.complete) throw terminal("Previous native cohort incomplete; no promotion")
        baseline = result.samples[baselineVersion]!
      } else {
        const batch = await step.do("health:baseline", once, () => probe(origin, `${owner}-baseline`, [baselineVersion]))
        if (batch.unknown) throw terminal("Invalid baseline receipts")
        baseline = await step.do("health:baseline-close", once, async () => cohortSample([batch], baselineVersion, from, Math.max(from + 1, Date.now())))
      }
      for (const phase of [10, 25, 75, 100] as const) {
        failedStep = `${phase}%`
        await step.do(`release:promote-${phase}`, once, () => broker.promote(owner, phase))
        if (native) await observe?.(immutable({ type: "promoted", phase }))
        const phaseStartedAt = await step.do(`health:start-${phase}`, once, async () => Math.max(history.at(-1)?.candidate.to ?? baseline.to, Date.now()))
        const batches: Awaited<ReturnType<typeof probe>>[] = []
        const nativeBatches: ReceiptBatch[] = []
        let nativeNeedsCapture = true
        let nativeWindowEnd: number | undefined
        let deadline: number | undefined
        let regressionDetected = false
        const collect = async (sample: number) => {
          const suffix = `${phase}${sample ? `-sample-${sample}` : ""}`
          const receipts = native ? undefined : await step.do(`health:cohort-${suffix}`, once, () => probe(origin, `${owner}-${suffix}`, [baselineVersion, candidateVersion]))
          // Broken attribution is not an approvable shortage of statistical power.
          if (receipts?.unknown) throw terminal("Invalid candidate receipts")
          if (receipts) batches.push(receipts)
          if (native && nativeNeedsCapture) {
            nativeBatches.push(await step.do(`health:receipts-${suffix}`, once, () => native.capture([baselineVersion, candidateVersion])))
            nativeWindowEnd = await step.do(`health:receipt-window-${suffix}`, once, async () => Math.max(phaseStartedAt + 1, Date.now()))
          }
          // Poll the frozen cohort until it closes. Appending fresh requests on
          // every poll chases ingestion forever and prevents regression detection.
          const nativeResult = native ? await readNative(`health:native-${suffix}`, nativeBatches, [baselineVersion, candidateVersion], phaseStartedAt, nativeWindowEnd!) : undefined
          if (nativeResult) nativeNeedsCapture = nativeResult.complete
          if (nativeResult && (nativeResult.attributionInvalid || nativeResult.conflicts)) throw terminal("Invalid native outcome attribution")
          const previous = history.at(-1)
          const observedAt = await step.do(`health:window-${suffix}`, once, async () => Math.max(phaseStartedAt + 1, (previous?.observedAt ?? previous?.candidate.to ?? 0) + 1, Date.now()))
          const snapshot = await step.do(`health:snapshot-${suffix}`, once, async () => {
            const candidate = nativeResult?.samples[candidateVersion] ?? cohortSample(batches, candidateVersion, phaseStartedAt, observedAt)
            const policy = { baselineVersion, candidateVersion, phaseStartedAt,
              baselineWindow: { from: baseline.from, to: baseline.to }, minTrials: 20,
              ...(native ? { earlyRegression: true } : {}),
              maxErrorRate: margins.maxErrorRate, maxIncrease: margins.maxIncrease, alpha: 0.05, comparisons: 4 }
            const decision = evaluateHealth(baseline, candidate, policy)
            const detected = regressionDetected || decision.status === "regression"
            const strictRoute = routeHealthReview(decision, margins)
            const route: HealthRoute = detected && progress?.allowRegressionOverride
              ? { status: "review", reason: "Regression detected in this stage. Explicit emergency override only; no automatic progression." }
              : strictRoute
            const evidence = { owner, phase, baseline, candidate, policy, margins, decision, route, evidenceSource,
              ...(native ? { observedAt } : {}),
              ...(nativeResult ? { telemetry: { complete: nativeResult.complete, missing: nativeResult.missing,
                conflicts: nativeResult.conflicts, invalid: nativeResult.invalid } } : {}),
              ...(progress ? { progression: { autoProgressMinutes: progress.autoProgressMinutes, allowRegressionOverride: progress.allowRegressionOverride,
                ...(progress.samplingIntervalSeconds ? { samplingIntervalSeconds: progress.samplingIntervalSeconds } : {}) } } : {}),
              ...(progress?.samplingIntervalSeconds ? { sample, regressionDetected: detected } : {}) }
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(evidence)))
            return { ...evidence, snapshot: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
              expiresAt: deadline ?? observedAt + (progress?.autoProgressMinutes ?? 5) * 60_000,
              chart: healthChart([{ elapsedSeconds: (observedAt - phaseStartedAt) / 1000, decision }],
                { baseline: baselineVersion, candidate: candidateVersion, maxErrorRate: margins.maxErrorRate }) }
          })
          deadline = snapshot.expiresAt
          regressionDetected = snapshot.regressionDetected ?? snapshot.decision.status === "regression"
          return snapshot
        }
        let sample = 0
        let snapshot = await collect(sample)
        const { chart: _chart, ...observation } = snapshot
        history.push(observation)
        // A confirmed regression restores first; no renderer/notification can delay recovery.
        if (snapshot.route.status === "rollback") throw terminal("Conclusive regression; approval is prohibited")
        // Sibling checkpoints only: no notification or rendering inside a health step.do.
        // A failed required observer fails closed and restores the owned allocation.
        await observe?.(immutable({ type: "observed", observations: history }))
        let basis: "health" | "human-risk-acceptance" | "deadline-risk-acceptance" = "health"
        let approval: { readonly reason: string; readonly acceptedAt: number } | undefined
        let currentObservation: HmdObservation = observation
        let waitIndex = 0
        while (snapshot.route.status === "review") {
          if (++waitIndex > 24) throw terminal("HMD sampling window exhausted")
          const suffix = `${phase}${sample ? `-sample-${sample}` : ""}`
          // Native step outputs are truncated: keep the approval identity and risk summary small.
          await step.do(`review:request-${suffix}${progress?.samplingIntervalSeconds ? `-poll-${waitIndex}` : ""}`, once, async () => ({ snapshot: snapshot.snapshot,
            expiresAt: snapshot.expiresAt, phase, baselineVersion, candidateVersion,
            reason: snapshot.route.status === "review" ? snapshot.route.reason : "",
            baselineTrials: snapshot.baseline.trials, candidateTrials: snapshot.candidate.trials,
            candidateFailures: snapshot.candidate.failures, candidateBounds: snapshot.decision.candidate,
            increaseBounds: snapshot.decision.increase, margins, evidenceSource, ...(native ? { earlyRegression: true } : {}), ...(snapshot.telemetry ? { telemetry: snapshot.telemetry } : {}) }))
          await step.do(`release:renew-before-review-${phase}-${waitIndex}`, once, () => broker.renew(owner))
          const window = progress?.samplingIntervalSeconds ? await step.do(`review:window-${phase}-${waitIndex}`, once, async () => ({
            milliseconds: Math.max(1, Math.min(progress.samplingIntervalSeconds! * 1000, snapshot.expiresAt - Date.now())),
          })) : undefined
          let response: { payload: unknown } | undefined
          try {
            response = await step.waitForEvent(window ? `review:phase-${phase}-poll-${waitIndex}` : `review:phase-${phase}`,
              { type: `hmd-review-${phase}`, timeout: window ? window.milliseconds : `${progress?.autoProgressMinutes ?? 5} minutes` })
          } catch (error) {
            await step.do(`review:wait-error-${phase}-${waitIndex}`, once, async () => ({ waitError: {
              name: error instanceof Error ? error.name : typeof error,
              message: error instanceof Error ? error.message.slice(0, 150) : "Non-error native wait failure",
            } }))
            // Only an actual native wait timeout is a release-policy deadline.
            // Delivery/auth/unknown errors, regression and lost ownership still restore.
            // Native local RPC drops the custom Error.name but preserves this
            // exact timeout message. Require the configured duration, elapsed
            // snapshot deadline and atomic review fence as independent checks.
            const timedOut = error instanceof Error && (error.name === "WorkflowTimeoutError" ||
              (error.name === "Error" && error.message === `Execution timed out after ${window?.milliseconds ?? (progress?.autoProgressMinutes ?? 5) * 60_000}ms`))
            if (!progress || !timedOut) throw error
          }
          const now = await step.do(`review:clock-${phase}-${waitIndex}`, once, async () => Date.now())
          if (!response && window && now < snapshot.expiresAt) {
            const canRefresh = await step.do(`review:refresh-${phase}-${waitIndex}`, once, () => progress!.onRefresh!(currentObservation))
            if (!canRefresh) continue // Never replace a consumed Progress/Reject before delivery resolves.
            snapshot = await collect(++sample)
            const { chart: _nextChart, ...next } = snapshot
            currentObservation = next
            history.push(next)
            if (snapshot.route.status === "rollback") throw terminal("Conclusive regression; approval is prohibited")
            await observe?.(immutable({ type: "observed", observations: history }))
            continue
          }
          // Checkpoint the acceptance time: replay preserves the original deadline evaluation.
          const resolution = await step.do(`review:resolve-${suffix}`, once, async () => {
            const acceptedAt = Date.now()
            if (!response) {
              if (!progress || acceptedAt < snapshot.expiresAt || regressionDetected) throw terminal("Progression deadline cannot accept this stage")
              await progress.onDeadline(currentObservation)
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
          break
        }
        // Clear health after resampling still verifies the current release lease/allocation.
        if (sample && basis === "health") {
          await step.do(`release:renew-after-health-${phase}`, once, () => broker.renew(owner))
          await step.do(`release:verify-after-health-${phase}`, once, () => broker.promote(owner, phase))
        }
        observations.push({ ...snapshot, basis, ...(approval ? { approval } : {}) })
        await observe?.(immutable({ type: "settled", observation: currentObservation, basis }))
      }
      const restored = await step.do("release:lab-cleanup", once, () => broker.rollback(owner))
      // Reporting must not turn successful recovery into a second deployment mutation.
      try { await observe?.(immutable({ type: "restored", failed: false })) } catch { /* allocation already restored */ }
      return { status: "reviewed-all-phases", observations, restored: restored.deployment,
        releaseCommitted: false, wobsVerified: false, evidenceSource }
    } catch (error) {
      await step.do("release:restore-baseline", once, () => broker.rollback(owner))
      if (history.at(-1)?.route.status === "rollback") {
        try { await observe?.(immutable({ type: "observed", observations: history })) } catch { /* recovery takes precedence */ }
      }
      try { await observe?.(immutable({ type: "restored", failed: true,
        failure: { stepId: failedStep, reason: hmdFailureReason(error) } })) } catch { /* preserve the recovery result */ }
      throw terminal("Review release failed closed; prior allocation restored")
    }
}
